<template>
  <div class="dive-view comic-page-dive">
    <!-- 顶部专业工作台工具栏 -->
    <header class="toolbar">
      <template v-if="graphComicPageNodes.length > 1">
        <div class="toolbar-group page-switcher-group">
          <button
            v-for="item in graphComicPageNodes"
            :key="item.id"
            type="button"
            class="tb-btn tb-btn--page"
            :class="{ 'tb-btn--active': item.id === activeNodeId }"
            :title="item.title"
            @click="switchActiveComicPageNode(item.id)"
          >
            {{ item.shortLabel }}
          </button>
        </div>
        <span class="tb-divider" />
      </template>

      <div class="toolbar-group">
        <button
          type="button"
          class="tb-btn"
          :class="{ 'tb-btn--active': showGlobal }"
          @click="showGlobalProps"
        >
          📄 {{ t('graph.inspector.comicPage.globalSection') }}
        </button>
        <button type="button" class="tb-btn" @click="addEmptyPanel">
          ➕ {{ t('graph.inspector.comicPage.addPanel') }}
        </button>
        <button
          type="button"
          class="tb-btn"
          :disabled="!selectedPanel && page.panels.length === 0"
          @click="addBubbleToSelected('oval')"
        >
          💬 {{ t('graph.inspector.comicPage.addBubble') }}
        </button>
        <button
          type="button"
          class="tb-btn"
          :disabled="!selectedPanel && page.panels.length === 0"
          @click="addBubbleToSelected('sfx')"
        >
          🔊 {{ pickComicBi('添加拟声词', 'Add SFX') }}
        </button>
      </div>

      <span class="tb-divider" />

      <div class="toolbar-group">
        <button
          v-if="incomingImages.length > 0"
          type="button"
          class="tb-btn tb-btn--accent-soft"
          :title="uiLabels.autoFillTitle"
          @click="autoFillFromIncoming(true)"
        >
          ⚡
          {{ pickComicBi('顺填上游图', 'Auto-fill') }} ({{ incomingImages.length }})
        </button>
        <button
          type="button"
          class="tb-btn tb-btn--danger"
          :disabled="!selectedPanel && !selectedBubble"
          @click="deleteCurrentSelection"
        >
          🗑
          {{
            selectedBubble
              ? t('graph.inspector.comicPage.removeBubble')
              : t('graph.inspector.comicPage.removePanel')
          }}
        </button>
      </div>

      <span class="spacer" />

      <div class="toolbar-group">
        <span class="page-spec-pill">
          {{ page.width }} × {{ page.height }} · {{ page.panels.length }}
          {{ pickComicBi('格', 'panels') }}
        </span>
        <button
          type="button"
          class="tb-btn"
          :class="{ 'tb-btn--active': animaticPlaying }"
          :disabled="page.panels.length === 0"
          :title="uiLabels.animaticTitle"
          @click="toggleAnimaticPreview"
        >
          {{
            animaticPlaying
              ? pickComicBi('⏹ 停止预演', '⏹ Stop Preview')
              : pickComicBi('▶️ 分镜预演', '▶️ Animatic')
          }}
        </button>
        <button
          type="button"
          class="tb-btn tb-btn--accent-soft"
          :disabled="page.panels.length === 0 || generatingMotionComic"
          :title="uiLabels.motionComicTitle"
          @click="onGenerateMotionComic"
        >
          🎬
          {{
            generatingMotionComic
              ? pickComicBi('合成中…', 'Building…')
              : pickComicBi('生成动态漫', 'Motion Comic')
          }}
        </button>
        <button
          type="button"
          class="tb-btn"
          :disabled="page.panels.length === 0"
          @click="canvasRef?.exportPng()"
        >
          🖼 {{ t('graph.inspector.comicPage.exportPng') }}
        </button>
        <button
          type="button"
          class="tb-btn"
          :disabled="page.panels.length === 0 || exportingPanelCards"
          :title="uiLabels.exportCardsTitle"
          @click="onExportPanelCardsPack"
        >
          🗂
          {{ exportingPanelCards ? pickComicBi('切图中…', 'Slicing…') : uiLabels.exportCardsBtn }}
        </button>
        <button
          v-if="allGraphComicPages.length > 1"
          type="button"
          class="tb-btn"
          :disabled="exportingStitchedStrip"
          :title="uiLabels.exportStripTitle"
          @click="onExportStitchedStrip"
        >
          📜
          {{
            exportingStitchedStrip ? pickComicBi('拼接中…', 'Stitching…') : uiLabels.exportStripBtn
          }}
        </button>
        <button type="button" class="tb-btn done" @click="onClose">
          ✓ {{ t('graph.inspector.comicPage.done') }}
        </button>
      </div>
    </header>

    <div class="body">
      <!-- 左侧：分镜模板库 + 气泡/拟声词预设坞 -->
      <aside class="left-dock">
        <div class="dock-tabs">
          <button
            type="button"
            class="dock-tab"
            :class="{ 'dock-tab--active': leftTab === 'templates' }"
            @click="leftTab = 'templates'"
          >
            📐 {{ pickComicBi('分镜模板', 'Layouts') }}
          </button>
          <button
            type="button"
            class="dock-tab"
            :class="{ 'dock-tab--active': leftTab === 'bubbles' }"
            @click="leftTab = 'bubbles'"
          >
            💬 {{ pickComicBi('气泡/音效', 'Speech/SFX') }}
          </button>
        </div>

        <!-- Tab 1: 分镜模板库 -->
        <div v-if="leftTab === 'templates'" class="dock-content">
          <div class="filter-pills">
            <button
              v-for="cat in templateCategories"
              :key="cat.id"
              type="button"
              class="filter-pill"
              :class="{ 'filter-pill--active': templateCategory === cat.id }"
              @click="templateCategory = cat.id"
            >
              {{ cat.label }}
            </button>
          </div>
          <p class="dock-hint">
            {{ uiLabels.applyTemplateHint }}
          </p>
          <div class="template-grid">
            <button
              v-for="tpl in filteredTemplates"
              :key="tpl.id"
              type="button"
              class="template-card"
              @click="onApplyTemplate(tpl.id)"
            >
              <svg
                class="template-thumb"
                :viewBox="`0 0 ${tpl.page.width} ${tpl.page.height}`"
                preserveAspectRatio="xMidYMid meet"
              >
                <rect
                  x="0"
                  y="0"
                  :width="tpl.page.width"
                  :height="tpl.page.height"
                  class="tpl-bg"
                />
                <polygon
                  v-for="(pts, idx) in templatePreviewPolygons(tpl)"
                  :key="idx"
                  :points="pts"
                  class="tpl-panel"
                />
              </svg>
              <div class="template-meta">
                <span class="template-name">{{ pickComicBi(tpl.name.zh, tpl.name.en) }}</span>
                <span class="template-desc">{{ pickComicBi(tpl.desc.zh, tpl.desc.en) }}</span>
              </div>
            </button>
          </div>
        </div>

        <!-- Tab 2: 气泡样式与拟声词预设库 -->
        <div v-else class="dock-content">
          <span class="field-label">{{
            pickComicBi('漫画对白框预设', 'Speech Bubble Presets')
          }}</span>
          <div class="bubble-preset-grid">
            <button
              v-for="bp in bubbleShapePresets"
              :key="bp.id"
              type="button"
              class="bubble-preset-card"
              @click="insertBubblePreset(bp)"
            >
              <span class="bp-icon">{{ bp.icon }}</span>
              <span class="bp-name">{{ bp.label }}</span>
            </button>
          </div>

          <span class="field-label">{{
            pickComicBi('漫画拟声词贴纸 (SFX)', 'Manga SFX Presets')
          }}</span>
          <div class="sfx-preset-grid">
            <button
              v-for="sfx in sfxPresets"
              :key="sfx.text"
              type="button"
              class="sfx-card"
              :style="{ color: sfx.color }"
              @click="insertSfxPreset(sfx)"
            >
              <span class="sfx-main">{{ sfx.text }}</span>
              <span class="sfx-sub">{{ sfx.desc }}</span>
            </button>
          </div>
        </div>
      </aside>

      <!-- 中央：100% 所见即所得无限视口画布 -->
      <ComicPageCanvas
        ref="canvasRef"
        class="canvas"
        :page="page"
        editable
        exportable
        :export-name="exportName"
        :selected-panel-id="selectedPanelId"
        :selected-bubble-id="selectedBubbleId"
        @select="onSelect"
        @move-bubble="onMoveBubble"
        @resize-panel="onResizePanel"
        @resize-bubble="onResizeBubble"
        @edit-end="onCanvasEditEnd"
        @drop-image="onDropImage"
        @remove-image="onRemoveImage"
        @update-panel="onCanvasUpdatePanel"
        @update-bubble="onCanvasUpdateBubble"
        @quick-add-panel="addPanelAtEmpty"
        @quick-add-bubble="addBubbleToPanel"
        @delete-panel="onDeletePanelById"
        @delete-bubble="onDeleteBubbleById"
        @duplicate-bubble="onDuplicateBubble"
        @swap-panels="onSwapPanels"
        @move-panel="onMovePanel"
        @transfer-bubble="onTransferBubble"
      />

      <!-- 右侧：上下文精细属性面板 + 分镜图层树 -->
      <aside class="side">
        <!-- 1. 页面全局属性 -->
        <template v-if="showGlobal">
          <div class="section-card">
            <h3>✨ {{ pickComicBi('AI 智能剧情排页与整页生图', 'AI Storyboard & Batch Gen') }}</h3>
            <label>
              {{ pickComicBi('本页剧情梗概 / 分镜脚本', 'Page Story Synopsis / Script') }}
              <textarea
                v-model="aiPageStoryPrompt"
                rows="2"
                :placeholder="uiLabels.aiStorySynopsisPlaceholder"
              />
            </label>
            <div class="row">
              <button
                type="button"
                class="mini-btn mini-btn--active"
                :disabled="generatingAiStoryboard || !aiPageStoryPrompt.trim()"
                @click="onGenerateAiPageStoryboard"
              >
                ✨
                {{
                  generatingAiStoryboard
                    ? pickComicBi('AI 排页中…', 'Planning…')
                    : pickComicBi('AI 排页 + 写台词', 'AI Layout & Script')
                }}
              </button>
              <button
                type="button"
                class="mini-btn"
                :disabled="generatingAllPanelImages || page.panels.length === 0"
                :title="uiLabels.batchGenPanelsTitle"
                @click="onGenerateAllPanelsImages"
              >
                🎨
                {{
                  generatingAllPanelImages
                    ? pickComicBi('批量生图中…', 'Generating…')
                    : pickComicBi('一键生图填满全页', 'Batch Gen All Panels')
                }}
              </button>
            </div>
            <label>
              {{
                translatingComicPage
                  ? uiLabels.translatingComicLabel
                  : uiLabels.translateComicHeader
              }}
              <div class="chip-row">
                <button
                  v-for="loc in comicLocaleTargets"
                  :key="loc.id"
                  type="button"
                  class="chip-btn"
                  :disabled="translatingComicPage || page.panels.length === 0"
                  @click="onTranslateComicPage(loc.id)"
                >
                  {{ loc.label }}
                </button>
              </div>
            </label>
          </div>

          <div class="section-card">
            <h3>📄 {{ t('graph.inspector.comicPage.globalSection') }}</h3>
            <label>
              {{ t('graph.inspector.comicPage.pageTitle') }}
              <input
                :value="page.title ?? ''"
                :placeholder="pickComicBi('可选页眉标题…', 'Optional page header…')"
                @change="onPageTitle(($event.target as HTMLInputElement).value)"
              />
            </label>

            <label>
              {{ pickComicBi('常用画布规格', 'Page Size Presets') }}
              <div class="chip-row">
                <button
                  v-for="sp in pageSizePresets"
                  :key="sp.label"
                  type="button"
                  class="chip-btn"
                  :class="{
                    'chip-btn--active': page.width === sp.width && page.height === sp.height
                  }"
                  @click="applyPageSizePreset(sp.width, sp.height)"
                >
                  {{ sp.label }}
                </button>
              </div>
            </label>

            <div class="row">
              <label>
                {{ t('graph.inspector.comicPage.width') }} (px)
                <input
                  type="number"
                  min="200"
                  max="4096"
                  :value="page.width"
                  @change="onMetaNumber('width', $event)"
                />
              </label>
              <label>
                {{ t('graph.inspector.comicPage.height') }} (px)
                <input
                  type="number"
                  min="200"
                  max="8192"
                  :value="page.height"
                  @change="onMetaNumber('height', $event)"
                />
              </label>
            </div>

            <div class="row">
              <label>
                {{ t('graph.inspector.comicPage.columns') }} (1~12)
                <input
                  type="number"
                  min="1"
                  max="12"
                  :value="page.columns"
                  @change="onMetaNumber('columns', $event)"
                />
              </label>
              <label>
                {{ t('graph.inspector.comicPage.rows') }} (1~12)
                <input
                  type="number"
                  min="1"
                  max="12"
                  :value="page.rows"
                  @change="onMetaNumber('rows', $event)"
                />
              </label>
            </div>

            <div class="row">
              <label>
                {{ t('graph.inspector.comicPage.gutter') }} (px)
                <input
                  type="number"
                  min="0"
                  max="120"
                  :value="page.gutter"
                  @change="onMetaNumber('gutter', $event)"
                />
              </label>
              <label>
                {{ pickComicBi('页面留白边距', 'Page Padding') }} (px)
                <input
                  type="number"
                  min="0"
                  max="200"
                  :value="page.padding ?? 0"
                  @change="onMetaNumber('padding', $event)"
                />
              </label>
            </div>

            <label>
              {{ pickComicBi('阅读顺序', 'Reading Order') }}
              <div class="segmented">
                <button
                  type="button"
                  :class="{ active: (page.readingDirection ?? 'ltr') === 'ltr' }"
                  @click="commit(withComicPageLayout(page, { readingDirection: 'ltr' }))"
                >
                  {{ pickComicBi('左 → 右 (国漫/美漫)', 'Left → Right') }}
                </button>
                <button
                  type="button"
                  :class="{ active: page.readingDirection === 'rtl' }"
                  @click="commit(withComicPageLayout(page, { readingDirection: 'rtl' }))"
                >
                  {{ pickComicBi('右 → 左 (传统日漫)', 'Right → Left') }}
                </button>
              </div>
            </label>
          </div>

          <div class="section-card">
            <h3>🖋 {{ pickComicBi('全局框线与纸张底色', 'Page Ink Border & Fill') }}</h3>
            <div class="row">
              <label>
                {{ pickComicBi('分镜框粗细', 'Border Width') }} (px)
                <input
                  type="number"
                  min="0"
                  max="20"
                  step="0.5"
                  :value="page.borderWidth ?? 1"
                  @change="onMetaNumber('borderWidth', $event)"
                />
              </label>
              <label>
                {{ pickComicBi('分镜框圆角', 'Corner Radius') }} (px)
                <input
                  type="number"
                  min="0"
                  max="48"
                  :value="page.borderRadius ?? 6"
                  @change="onMetaNumber('borderRadius', $event)"
                />
              </label>
            </div>

            <div class="row">
              <label>
                {{ pickComicBi('分镜框颜色', 'Border Color') }}
                <input
                  type="color"
                  class="color-input"
                  :value="pageBorderHex"
                  @input="onPageBorderColor(($event.target as HTMLInputElement).value, false)"
                  @change="onPageBorderColor(($event.target as HTMLInputElement).value, true)"
                />
              </label>
              <label>
                {{ t('graph.inspector.comicPage.bgColor') }}
                <input
                  type="color"
                  class="color-input"
                  :title="
                    page.backgroundColor?.trim() || t('graph.inspector.comicPage.bgTransparent')
                  "
                  :value="pageBgHex"
                  @input="onBackgroundColor(($event.target as HTMLInputElement).value, false)"
                  @change="onBackgroundColor(($event.target as HTMLInputElement).value, true)"
                />
              </label>
            </div>
            <label>
              {{ pickComicBi('一键全页漫种风格转换', 'One-Click Page Genre Presets') }}
              <div class="chip-row">
                <button type="button" class="chip-btn" @click="applyPageGenrePreset('manga-bw')">
                  🇯🇵 {{ pickComicBi('日漫黑白竖排', 'Manga B&W Vertical') }}
                </button>
                <button type="button" class="chip-btn" @click="applyPageGenrePreset('halftone')">
                  📰 {{ pickComicBi('复古网点漫', 'Halftone Screentone') }}
                </button>
                <button type="button" class="chip-btn" @click="applyPageGenrePreset('webtoon')">
                  📱 {{ pickComicBi('韩系竖屏条漫', 'Webtoon Long Strip') }}
                </button>
                <button
                  type="button"
                  class="chip-btn"
                  @click="applyPageGenrePreset('color-action')"
                >
                  🎬 {{ pickComicBi('全彩高燃国漫', 'Full-Color Action') }}
                </button>
              </div>
            </label>
            <div class="row">
              <button
                type="button"
                class="mini-btn"
                @click="
                  commit(
                    withComicPageLayout(page, {
                      backgroundColor: '#ffffff',
                      borderColor: '#111111',
                      borderWidth: 3,
                      borderRadius: 0,
                      padding: page.padding || 32
                    })
                  )
                "
              >
                {{ pickComicBi('日漫白纸黑框风格', 'Manga Ink Style') }}
              </button>
              <button
                type="button"
                class="mini-btn"
                :disabled="!page.backgroundColor?.trim()"
                @click="onBackgroundColor('', true)"
              >
                {{ t('graph.inspector.comicPage.bgTransparent') }}
              </button>
            </div>
          </div>
        </template>

        <!-- 2. 选中分镜格属性 -->
        <template v-if="selectedPanel && !selectedBubble">
          <div class="section-card">
            <h3>🖼 {{ t('graph.inspector.comicPage.panelSection') }} ({{ selectedPanel.id }})</h3>
            <div class="row">
              <label>
                {{ t('graph.inspector.comicPage.panelTitle') }}
                <input
                  :value="selectedPanel.title ?? ''"
                  :placeholder="pickComicBi('占位/镜头名', 'Shot title')"
                  @change="patchSelectedPanel({ title: ($event.target as HTMLInputElement).value })"
                />
              </label>
              <label>
                {{ pickComicBi('叠格层级 (zIndex)', 'Layer zIndex') }}
                <select
                  :value="selectedPanel.zIndex ?? 0"
                  @change="
                    patchSelectedPanel({
                      zIndex: Number(($event.target as HTMLSelectElement).value)
                    })
                  "
                >
                  <option :value="-1">{{ pickComicBi('底层 (-1)', 'Back (-1)') }}</option>
                  <option :value="0">{{ pickComicBi('标准层 (0)', 'Normal (0)') }}</option>
                  <option :value="2">
                    {{ pickComicBi('画中画叠格 (+2 带白衬边)', 'Inset Overlay (+2 Halo)') }}
                  </option>
                </select>
              </label>
            </div>

            <label>
              {{ pickComicBi('底部旁白字幕条 (Caption)', 'Bottom Narration Caption') }}
              <input
                :value="selectedPanel.caption ?? ''"
                :placeholder="pickComicBi('例如：三天后，王都北门…', 'e.g. Three days later…')"
                @change="patchSelectedPanel({ caption: ($event.target as HTMLInputElement).value })"
              />
            </label>

            <div class="row-4">
              <label>
                col
                <input
                  type="number"
                  min="0"
                  :max="page.columns - 1"
                  :value="selectedPanel.col"
                  @change="onPanelGridPos('col', $event)"
                />
              </label>
              <label>
                row
                <input
                  type="number"
                  min="0"
                  :max="page.rows - 1"
                  :value="selectedPanel.row"
                  @change="onPanelGridPos('row', $event)"
                />
              </label>
              <label>
                colSpan
                <input
                  type="number"
                  min="1"
                  :value="selectedPanel.colSpan"
                  @change="onSpan('colSpan', $event)"
                />
              </label>
              <label>
                rowSpan
                <input
                  type="number"
                  min="1"
                  :value="selectedPanel.rowSpan"
                  @change="onSpan('rowSpan', $event)"
                />
              </label>
            </div>

            <!-- 斜切分镜刀口预设 -->
            <label>
              {{ pickComicBi('斜切分镜刀口线 (Slant Cut)', 'Diagonal Slant Cut') }}
              <div class="chip-row">
                <button
                  v-for="sp in slantPresets"
                  :key="sp.id"
                  type="button"
                  class="chip-btn"
                  @click="applySlantPreset(sp.id)"
                >
                  {{ sp.label }}
                </button>
              </div>
            </label>
          </div>

          <!-- 格内画面构图与漫画滤镜 -->
          <div class="section-card">
            <div class="card-head-row">
              <h3>
                🔍 {{ pickComicBi('格内构图取景与漫画滤镜', 'Intra-Panel Framing & Filter') }}
              </h3>
              <div class="card-head-actions">
                <button
                  v-if="selectedPanel.imageUrl"
                  type="button"
                  class="mini-btn"
                  @click="patchSelectedPanel({ imageUrl: '' })"
                >
                  × {{ t('graph.inspector.comicPage.clearImage') }}
                </button>
                <button
                  type="button"
                  class="mini-btn"
                  @click="
                    patchSelectedPanel({
                      imagePanX: 0,
                      imagePanY: 0,
                      imageZoom: 1,
                      imageRotation: 0,
                      imageFlipX: false,
                      imageFilter: 'none'
                    })
                  "
                >
                  {{ pickComicBi('重置', 'Reset') }}
                </button>
              </div>
            </div>

            <!-- 工作台内原地 AI 生图 / 重绘当前分镜格 -->
            <div class="row">
              <input
                v-model="panelAiPrompt"
                :placeholder="selectedPanel.title || uiLabels.panelAiPromptPlaceholder"
                @keydown.enter.prevent="onGeneratePanelImageInPlace"
              />
              <button
                type="button"
                class="mini-btn mini-btn--active"
                :disabled="generatingPanelImage"
                :title="uiLabels.panelAiGenTitle"
                @click="onGeneratePanelImageInPlace"
              >
                🎨
                {{
                  generatingPanelImage
                    ? pickComicBi('生成中…', 'Generating…')
                    : selectedPanel.imageUrl
                      ? pickComicBi('AI 重绘此格', 'AI Redraw')
                      : pickComicBi('AI 生图填格', 'AI Generate')
                }}
              </button>
            </div>

            <label>
              <span class="slider-head">
                <span>{{ pickComicBi('特写缩放 (Zoom)', 'Zoom') }}</span>
                <span>{{ Math.round((selectedPanel.imageZoom ?? 1) * 100) }}%</span>
              </span>
              <input
                type="range"
                min="0.5"
                max="3.5"
                step="0.05"
                :value="selectedPanel.imageZoom ?? 1"
                @input="
                  patchSelectedPanel(
                    { imageZoom: Number(($event.target as HTMLInputElement).value) },
                    { persist: false }
                  )
                "
                @change="
                  patchSelectedPanel({
                    imageZoom: Number(($event.target as HTMLInputElement).value)
                  })
                "
              />
            </label>

            <div class="row">
              <label>
                <span class="slider-head">
                  <span>{{ pickComicBi('水平偏移 X', 'Pan X') }}</span>
                  <span>{{ Math.round((selectedPanel.imagePanX ?? 0) * 100) }}%</span>
                </span>
                <input
                  type="range"
                  min="-1"
                  max="1"
                  step="0.02"
                  :value="selectedPanel.imagePanX ?? 0"
                  @input="
                    patchSelectedPanel(
                      { imagePanX: Number(($event.target as HTMLInputElement).value) },
                      { persist: false }
                    )
                  "
                  @change="
                    patchSelectedPanel({
                      imagePanX: Number(($event.target as HTMLInputElement).value)
                    })
                  "
                />
              </label>
              <label>
                <span class="slider-head">
                  <span>{{ pickComicBi('垂直偏移 Y', 'Pan Y') }}</span>
                  <span>{{ Math.round((selectedPanel.imagePanY ?? 0) * 100) }}%</span>
                </span>
                <input
                  type="range"
                  min="-1"
                  max="1"
                  step="0.02"
                  :value="selectedPanel.imagePanY ?? 0"
                  @input="
                    patchSelectedPanel(
                      { imagePanY: Number(($event.target as HTMLInputElement).value) },
                      { persist: false }
                    )
                  "
                  @change="
                    patchSelectedPanel({
                      imagePanY: Number(($event.target as HTMLInputElement).value)
                    })
                  "
                />
              </label>
            </div>

            <div class="row">
              <label>
                <span class="slider-head">
                  <span>{{ pickComicBi('倾斜角 (Dutch Angle)', 'Rotation') }}</span>
                  <span>{{ selectedPanel.imageRotation ?? 0 }}°</span>
                </span>
                <input
                  type="range"
                  min="-45"
                  max="45"
                  step="1"
                  :value="selectedPanel.imageRotation ?? 0"
                  @input="
                    patchSelectedPanel(
                      { imageRotation: Number(($event.target as HTMLInputElement).value) },
                      { persist: false }
                    )
                  "
                  @change="
                    patchSelectedPanel({
                      imageRotation: Number(($event.target as HTMLInputElement).value)
                    })
                  "
                />
              </label>
              <label>
                {{ pickComicBi('镜像与适配', 'Mirror & Fit') }}
                <div class="row">
                  <button
                    type="button"
                    class="mini-btn"
                    :class="{ 'mini-btn--active': selectedPanel.imageFlipX }"
                    @click="patchSelectedPanel({ imageFlipX: !selectedPanel.imageFlipX })"
                  >
                    ↔ {{ pickComicBi('翻转', 'Flip') }}
                  </button>
                  <button
                    type="button"
                    class="mini-btn"
                    @click="
                      patchSelectedPanel({
                        imageFit: selectedPanel.imageFit === 'contain' ? 'cover' : 'contain'
                      })
                    "
                  >
                    {{ selectedPanel.imageFit === 'contain' ? 'Contain' : 'Cover' }}
                  </button>
                </div>
              </label>
            </div>

            <label>
              {{ pickComicBi('漫画网点与色调滤镜', 'Manga Toning Filter') }}
              <div class="chip-row">
                <button
                  v-for="fl in filterOptions"
                  :key="fl.id"
                  type="button"
                  class="chip-btn"
                  :class="{
                    'chip-btn--active': (selectedPanel.imageFilter ?? 'none') === fl.id
                  }"
                  @click="patchSelectedPanel({ imageFilter: fl.id })"
                >
                  {{ fl.label }}
                </button>
              </div>
            </label>
          </div>

          <!-- 漫画镜头速度线与氛围特效 -->
          <div class="section-card">
            <h3>⚡ {{ pickComicBi('漫画镜头特效 (Speed & Focus FX)', 'Manga Lens FX') }}</h3>
            <div class="chip-row">
              <button
                v-for="ef in effectOptions"
                :key="ef.id"
                type="button"
                class="chip-btn"
                :class="{
                  'chip-btn--active': (selectedPanel.effectType ?? 'none') === ef.id
                }"
                @click="patchSelectedPanel({ effectType: ef.id })"
              >
                {{ ef.label }}
              </button>
            </div>

            <template v-if="selectedPanel.effectType && selectedPanel.effectType !== 'none'">
              <label>
                <span class="slider-head">
                  <span>{{ pickComicBi('线条密度/强度', 'FX Intensity') }}</span>
                  <span>{{ Math.round((selectedPanel.effectIntensity ?? 0.6) * 100) }}%</span>
                </span>
                <input
                  type="range"
                  min="0.15"
                  max="1"
                  step="0.05"
                  :value="selectedPanel.effectIntensity ?? 0.6"
                  @input="
                    patchSelectedPanel(
                      { effectIntensity: Number(($event.target as HTMLInputElement).value) },
                      { persist: false }
                    )
                  "
                  @change="
                    patchSelectedPanel({
                      effectIntensity: Number(($event.target as HTMLInputElement).value)
                    })
                  "
                />
              </label>

              <label v-if="selectedPanel.effectType === 'speed-lines'">
                <span class="slider-head">
                  <span>{{ pickComicBi('速度线方向角', 'Speed Lines Angle') }}</span>
                  <span>{{ selectedPanel.effectAngle ?? 0 }}°</span>
                </span>
                <input
                  type="range"
                  min="0"
                  max="360"
                  step="5"
                  :value="selectedPanel.effectAngle ?? 0"
                  @input="
                    patchSelectedPanel(
                      { effectAngle: Number(($event.target as HTMLInputElement).value) },
                      { persist: false }
                    )
                  "
                  @change="
                    patchSelectedPanel({
                      effectAngle: Number(($event.target as HTMLInputElement).value)
                    })
                  "
                />
              </label>

              <div class="row">
                <button
                  type="button"
                  class="mini-btn"
                  :class="{
                    'mini-btn--active': (selectedPanel.effectColor ?? '#111111') !== '#ffffff'
                  }"
                  @click="patchSelectedPanel({ effectColor: '#111111' })"
                >
                  {{ pickComicBi('🖤 黑墨锋线', '🖤 Black Ink') }}
                </button>
                <button
                  type="button"
                  class="mini-btn"
                  :class="{ 'mini-btn--active': selectedPanel.effectColor === '#ffffff' }"
                  @click="patchSelectedPanel({ effectColor: '#ffffff' })"
                >
                  {{ pickComicBi('🤍 白光闪线', '🤍 White Flash') }}
                </button>
              </div>
            </template>

            <div class="row">
              <label>
                {{ t('graph.inspector.comicPage.bgColor') }}
                <input
                  type="color"
                  class="color-input"
                  :value="panelBgHex"
                  @input="onPanelBackgroundColor(($event.target as HTMLInputElement).value, false)"
                  @change="onPanelBackgroundColor(($event.target as HTMLInputElement).value, true)"
                />
              </label>
              <label>
                {{ pickComicBi('单格框线粗细', 'Panel Border') }}
                <input
                  type="number"
                  min="0"
                  max="20"
                  :placeholder="pickComicBi('跟随全局', 'Inherit')"
                  :value="selectedPanel.borderWidth ?? ''"
                  @change="onPanelBorderWidth($event)"
                />
              </label>
            </div>
          </div>

          <!-- 动态漫运镜与时长配置 -->
          <div class="section-card">
            <h3>
              🎬
              {{ pickComicBi('动态漫运镜与时长 (Motion Comic)', 'Motion Comic Camera & Timing') }}
            </h3>
            <label>
              {{ pickComicBi('单格运镜预设', 'Panel Camera Motion') }}
              <div class="chip-row">
                <button
                  v-for="cm in cameraMotionOptions"
                  :key="cm.id"
                  type="button"
                  class="chip-btn"
                  :class="{
                    'chip-btn--active': (selectedPanel.cameraMotion ?? 'auto') === cm.id
                  }"
                  @click="patchSelectedPanel({ cameraMotion: cm.id })"
                >
                  {{ cm.label }}
                </button>
              </div>
            </label>

            <div class="row">
              <label>
                {{ pickComicBi('停留时长 (秒)', 'Duration (sec)') }}
                <input
                  type="number"
                  min="0.5"
                  max="60"
                  step="0.2"
                  :placeholder="pickComicBi('自动按台词推算', 'Auto from dialogue')"
                  :value="selectedPanel.durationSec ?? ''"
                  @change="onPanelDurationSec($event)"
                />
              </label>
              <label>
                {{ pickComicBi('动静混排视频源 (可选)', 'Panel Video URL (opt)') }}
                <input
                  :value="selectedPanel.videoUrl ?? ''"
                  :placeholder="pickComicBi('相对路径，高潮格可播视频', 'Relative video path')"
                  @change="
                    patchSelectedPanel({ videoUrl: ($event.target as HTMLInputElement).value })
                  "
                />
              </label>
            </div>

            <div class="row">
              <button
                type="button"
                class="mini-btn"
                :disabled="!selectedPanel.imageUrl || generatingPanelVideo"
                @click="onGeneratePanelMicroVideo"
              >
                {{
                  generatingPanelVideo
                    ? pickComicBi('⏳ 生成微动视频中...', '⏳ Generating I2V...')
                    : pickComicBi('⚡ AI 生成微动视频 (I2V)', '⚡ Generate Micro-Video (I2V)')
                }}
              </button>
              <button
                type="button"
                class="mini-btn"
                :disabled="!selectedPanel.imageUrl || extractingPanelForeground"
                @click="onExtractPanelForeground"
              >
                {{
                  extractingPanelForeground
                    ? pickComicBi('⏳ 提取立绘中...', '⏳ Extracting FG...')
                    : pickComicBi('✂️ AI 抠取前景立绘 (2.5D)', '✂️ Extract 2.5D Foreground')
                }}
              </button>
            </div>

            <div class="row">
              <label>
                {{ pickComicBi('2.5D 前景立绘图 (可选)', '2.5D Foreground PNG') }}
                <input
                  :value="selectedPanel.foregroundImageUrl ?? ''"
                  :placeholder="pickComicBi('透明人物立绘相对路径', 'Transparent FG image path')"
                  @change="
                    patchSelectedPanel({
                      foregroundImageUrl: ($event.target as HTMLInputElement).value
                    })
                  "
                />
              </label>
              <label v-if="selectedPanel.foregroundImageUrl">
                <span class="slider-head">
                  <span>{{ pickComicBi('2.5D 视差深度', 'Parallax Depth') }}</span>
                  <span>{{ Math.round((selectedPanel.parallaxDepth ?? 0.5) * 100) }}%</span>
                </span>
                <input
                  type="range"
                  min="0.1"
                  max="1"
                  step="0.05"
                  :value="selectedPanel.parallaxDepth ?? 0.5"
                  @input="
                    patchSelectedPanel(
                      { parallaxDepth: Number(($event.target as HTMLInputElement).value) },
                      { persist: false }
                    )
                  "
                  @change="
                    patchSelectedPanel({
                      parallaxDepth: Number(($event.target as HTMLInputElement).value)
                    })
                  "
                />
              </label>
            </div>
            <div v-if="selectedPanel.foregroundImageUrl" class="row">
              <button
                type="button"
                class="mini-btn"
                :class="{ 'mini-btn--active': selectedPanel.popOutFrame !== false }"
                :title="uiLabels.popOutFrameTitle"
                @click="
                  patchSelectedPanel({
                    popOutFrame: selectedPanel.popOutFrame === false ? true : false
                  })
                "
              >
                🦸
                {{
                  selectedPanel.popOutFrame !== false
                    ? pickComicBi('已开启：人物破框出格立体渲染', 'Pop-Out Frame Breaking: ON')
                    : pickComicBi('开启人物破框出格立体渲染', 'Enable Pop-Out Frame Breaking')
                }}
              </button>
            </div>
          </div>
        </template>

        <!-- 3. 选中台词气泡 / 拟声词属性 -->
        <template v-if="selectedBubble && selectedPanel">
          <div class="section-card">
            <h3>💬 {{ t('graph.inspector.comicPage.bubbleSection') }}</h3>
            <label>
              {{ t('graph.inspector.comicPage.bubbleText') }}
              <textarea
                rows="3"
                :value="selectedBubble.text"
                @input="
                  patchSelectedBubble({ text: ($event.target as HTMLTextAreaElement).value }, false)
                "
                @change="
                  patchSelectedBubble({ text: ($event.target as HTMLTextAreaElement).value }, true)
                "
              />
            </label>
            <label>
              {{ t('graph.inspector.comicPage.speaker') }}
              <input
                :value="selectedBubble.speaker ?? ''"
                :placeholder="pickComicBi('角色名（可选）', 'Speaker (optional)')"
                @change="
                  patchSelectedBubble({ speaker: ($event.target as HTMLInputElement).value })
                "
              />
            </label>

            <label>
              {{ pickComicBi('气泡形状', 'Bubble Shape') }}
              <div class="chip-row">
                <button
                  v-for="sh in bubbleShapes"
                  :key="sh.id"
                  type="button"
                  class="chip-btn"
                  :class="{
                    'chip-btn--active': (selectedBubble.shape ?? 'rounded') === sh.id
                  }"
                  @click="patchSelectedBubble({ shape: sh.id })"
                >
                  {{ sh.label }}
                </button>
              </div>
            </label>

            <div class="row">
              <label>
                {{ pickComicBi('排版方向', 'Writing Mode') }}
                <div class="segmented">
                  <button
                    type="button"
                    :class="{
                      active: (selectedBubble.writingMode ?? 'horizontal-tb') === 'horizontal-tb'
                    }"
                    @click="patchSelectedBubble({ writingMode: 'horizontal-tb' })"
                  >
                    {{ pickComicBi('横排', 'Horz') }}
                  </button>
                  <button
                    type="button"
                    :class="{ active: selectedBubble.writingMode === 'vertical-rl' }"
                    @click="patchSelectedBubble({ writingMode: 'vertical-rl' })"
                  >
                    {{ pickComicBi('竖排 (日漫)', 'Vert') }}
                  </button>
                </div>
              </label>
              <label>
                {{ pickComicBi('字重', 'Font Weight') }}
                <select
                  :value="selectedBubble.fontWeight ?? 'normal'"
                  @change="
                    patchSelectedBubble({
                      fontWeight: ($event.target as HTMLSelectElement).value as
                        'normal' | 'bold' | 'black'
                    })
                  "
                >
                  <option value="normal">{{ pickComicBi('标准', 'Normal') }}</option>
                  <option value="bold">{{ pickComicBi('加粗', 'Bold') }}</option>
                  <option value="black">{{ pickComicBi('极粗冲击', 'Heavy Black') }}</option>
                </select>
              </label>
            </div>

            <div class="row">
              <label>
                <span class="slider-head">
                  <span>{{ pickComicBi('尺寸缩放', 'Scale') }}</span>
                  <span>{{ Math.round((selectedBubble.scale ?? 1) * 100) }}%</span>
                </span>
                <input
                  type="range"
                  min="0.5"
                  max="4"
                  step="0.05"
                  :value="selectedBubble.scale ?? 1"
                  @input="
                    patchSelectedBubble(
                      { scale: Number(($event.target as HTMLInputElement).value) },
                      false
                    )
                  "
                  @change="
                    patchSelectedBubble({
                      scale: Number(($event.target as HTMLInputElement).value)
                    })
                  "
                />
              </label>
              <label>
                <span class="slider-head">
                  <span>{{ pickComicBi('旋转角', 'Rotation') }}</span>
                  <span>{{ selectedBubble.rotation ?? 0 }}°</span>
                </span>
                <input
                  type="range"
                  min="-60"
                  max="60"
                  step="1"
                  :value="selectedBubble.rotation ?? 0"
                  @input="
                    patchSelectedBubble(
                      { rotation: Number(($event.target as HTMLInputElement).value) },
                      false
                    )
                  "
                  @change="
                    patchSelectedBubble({
                      rotation: Number(($event.target as HTMLInputElement).value)
                    })
                  "
                />
              </label>
            </div>

            <div class="row">
              <label>
                {{ t('graph.inspector.comicPage.tail') }}
                <select
                  :value="selectedBubble.tail"
                  @change="
                    patchSelectedBubble({
                      tail: ($event.target as HTMLSelectElement).value as ComicBubbleTail,
                      tailTipX: undefined,
                      tailTipY: undefined
                    })
                  "
                >
                  <option value="tl">↖ tl</option>
                  <option value="tr">↗ tr</option>
                  <option value="bl">↙ bl</option>
                  <option value="br">↘ br</option>
                </select>
              </label>
              <label>
                {{ pickComicBi('描边粗细', 'Stroke Width') }}
                <input
                  type="number"
                  min="0"
                  max="12"
                  step="0.5"
                  :value="selectedBubble.strokeWidth ?? 2"
                  @change="
                    patchSelectedBubble({
                      strokeWidth: Number(($event.target as HTMLInputElement).value)
                    })
                  "
                />
              </label>
            </div>

            <div class="row-3">
              <label>
                {{ pickComicBi('底色', 'Fill') }}
                <input
                  type="color"
                  class="color-input"
                  :value="cssHexOrFallback(selectedBubble.backgroundColor, '#ffffff')"
                  @input="
                    patchSelectedBubble(
                      { backgroundColor: ($event.target as HTMLInputElement).value },
                      false
                    )
                  "
                  @change="
                    patchSelectedBubble({
                      backgroundColor: ($event.target as HTMLInputElement).value
                    })
                  "
                />
              </label>
              <label>
                {{ pickComicBi('框线色', 'Stroke') }}
                <input
                  type="color"
                  class="color-input"
                  :value="cssHexOrFallback(selectedBubble.borderColor, '#111111')"
                  @input="
                    patchSelectedBubble(
                      { borderColor: ($event.target as HTMLInputElement).value },
                      false
                    )
                  "
                  @change="
                    patchSelectedBubble({
                      borderColor: ($event.target as HTMLInputElement).value
                    })
                  "
                />
              </label>
              <label>
                {{ pickComicBi('文字色', 'Text') }}
                <input
                  type="color"
                  class="color-input"
                  :value="cssHexOrFallback(selectedBubble.textColor, '#1a1a1a')"
                  @input="
                    patchSelectedBubble(
                      { textColor: ($event.target as HTMLInputElement).value },
                      false
                    )
                  "
                  @change="
                    patchSelectedBubble({
                      textColor: ($event.target as HTMLInputElement).value
                    })
                  "
                />
              </label>
            </div>
          </div>
        </template>

        <!-- 4. 分镜与台词层级快选树（常驻底部） -->
        <div class="section-card layer-tree-card">
          <div class="card-head-row">
            <h3>🗂 {{ pickComicBi('分镜与气泡大纲', 'Panels & Dialogue Tree') }}</h3>
            <span class="muted-count">{{ page.panels.length }}</span>
          </div>
          <div v-if="page.panels.length" class="layer-list">
            <div v-for="(p, idx) in page.panels" :key="p.id" class="layer-panel-group">
              <div
                class="layer-item"
                :class="{
                  'layer-item--active': selectedPanelId === p.id && !selectedBubbleId
                }"
                @click="selectPanelFromTree(p.id)"
              >
                <span class="layer-index">#{{ idx + 1 }}</span>
                <span class="layer-name">
                  {{ p.title || `${p.colSpan}×${p.rowSpan} (${p.row},${p.col})` }}
                </span>
                <span v-if="p.imageUrl" class="layer-tag">🖼</span>
                <span v-if="p.effectType && p.effectType !== 'none'" class="layer-tag">⚡</span>
              </div>
              <div
                v-for="b in p.bubbles"
                :key="b.id"
                class="layer-bubble-item"
                :class="{ 'layer-item--active': selectedBubbleId === b.id }"
                @click.stop="selectBubbleFromTree(p.id, b.id)"
              >
                <span>{{ b.shape === 'sfx' ? '🔊' : '💬' }}</span>
                <span class="layer-bubble-text"
                  >{{ b.speaker ? `${b.speaker}: ` : '' }}{{ b.text }}</span
                >
              </div>
            </div>
          </div>
          <p v-else class="hint">
            {{ uiLabels.emptyLayerHint }}
          </p>
        </div>
      </aside>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { isDraftAssetId } from '@shared/domain'
import { parseGraphHostContext } from '@shared/editorGlobals'
import {
  addComicBubble,
  addComicPanel,
  applyComicLayoutTemplate,
  buildComicMotionTimeline,
  COMIC_LAYOUT_TEMPLATES,
  comicOccupiedCellKeys,
  comicPanelPolygon,
  comicPanelRects,
  contentEndSecOfTimeline,
  createComicPage,
  duplicateComicBubble,
  estimateComicBubbleDurationSec,
  extractComicDialogueLines,
  fillComicPageFromImageUrls,
  findEmptyComicCell,
  moveComicPanel,
  normalizeComicPage,
  parseComicPage,
  readComicPageFromGenParams,
  readingOrderBubbles,
  readingOrderPanels,
  removeComicBubble,
  removeComicPanel,
  serializeComicPage,
  slantPresetToCornerOffsets,
  swapComicPanelContents,
  updateComicBubble,
  upsertComicPanel,
  withComicPageLayout,
  withScriptTimeline,
  type ComicBubbleShape,
  type ComicBubbleTail,
  type ComicBubbleWritingMode,
  type ComicCornerOffsets,
  type ComicLayoutTemplate,
  type ComicPage,
  type ComicPanel,
  type ComicPanelCameraMotion,
  type ComicPanelEffectType,
  type ComicPanelFilter,
  type ComicPanelSlantPreset,
  type ComicSpeechBubble,
  type ScriptTimelineClip,
  type ScriptTimelineDocument,
  type ScriptTimelineSettings,
  type ScriptTimelineSource
} from '@shared/graph'
import { persistAssetRecord } from '../../composables/useAssetRecord'
import {
  composeComicPanelCardsPack,
  composeStitchedComicStripImage
} from '../../features/comic/composeComicPageImage'
import { editorDiveKey } from '../../features/graph/model/editorDive'
import { graphEditorHosts } from '../../features/graph/model/graphEditorHosts'
import { removeImageSolidBackground } from '../../features/graph/model/removeImageSolidBackground'
import { saveGraphRunMediaForNode } from '../../features/graph/saveGraphRunMediaForNode'
import { diveEditorHistory } from '../../features/graph/ui/diveEditorHistory'
import { useEditorDiveFrameFlush } from '../../composables/useEditorDiveFrameFlush'
import { useStudioI18n } from '../../composables/useStudioI18n'
import { useDraftStore } from '../../stores/drafts'
import { useProjectStore } from '../../stores/project'
import ComicPageCanvas, { type ComicPageCanvasHit } from '../ComicPageCanvas.vue'

const props = defineProps<{
  frameKey: string
  hostId: string
  nodeId: string
}>()

const activeNodeId = ref(props.nodeId)
const { t, locale } = useStudioI18n()
const project = useProjectStore()
const drafts = useDraftStore()
const editorDive = inject(editorDiveKey, null)
const hostAssetId = computed(() => parseGraphHostContext(props.hostId).id?.trim() || '')
const generatingMotionComic = ref(false)
const generatingPanelVideo = ref(false)
const extractingPanelForeground = ref(false)
const exportingStitchedStrip = ref(false)
const exportingPanelCards = ref(false)
const generatingPanelImage = ref(false)
const generatingAiStoryboard = ref(false)
const generatingAllPanelImages = ref(false)
const translatingComicPage = ref(false)
const animaticPlaying = ref(false)
const panelAiPrompt = ref('')
const aiPageStoryPrompt = ref('')
const canvasRef = ref<{
  exportPng: () => Promise<void>
  renderPngDataUrl: () => Promise<string>
  renderMotionComicBundle?: () => Promise<{
    dataUrl: string
    panelDataUrls: Record<string, string>
    bubbleDataUrls: Record<string, string>
  }>
  fitToViewport: (animated?: boolean) => void
  focusPanelInViewport?: (panelId: string) => void
  setZoom100: () => void
} | null>(null)

function pickComicBi(zh: string, en: string): string {
  return String(locale.value || 'zh-CN')
    .toLowerCase()
    .startsWith('zh')
    ? zh
    : en
}

const uiLabels = computed(() => ({
  autoFillTitle: pickComicBi(
    '按阅读顺序将上游图片填入空白分镜格', // cjk-ok
    'Fill empty panels with upstream images in reading order'
  ),
  applyTemplateHint: pickComicBi(
    '点击套用分镜（自动保留并按序迁移现有图片与台词）', // cjk-ok
    'Click to apply layout (keeps existing images & dialogue)'
  ),
  emptyLayerHint: pickComicBi(
    '可从左侧「分镜模板」一键生成专业排版', // cjk-ok
    'Pick a layout preset on the left to start'
  ),
  motionComicTitle: pickComicBi(
    '将当前漫画分格、气泡台词与拟声词一键编译为多轨动态漫时间线（自动推拉摇移运镜 + 卡拉 OK 字幕 + 贴纸音效）', // cjk-ok
    'Compile comic panels, speech bubbles & SFX into a multi-track Motion Comic timeline'
  ),
  animaticTitle: pickComicBi(
    '在画布内按阅读顺序逐格推镜预演分镜节奏与气泡台词（已生成配音时同步朗读）', // cjk-ok
    'Preview panels and dialogue bubbles in reading order with smooth camera pan & zoom'
  ),
  exportCardsTitle: pickComicBi(
    '按阅读顺序将当前页每个分镜格（含对白气泡与镜头特效）独立导出为高清多图轮播卡片包', // cjk-ok
    'Export each panel (with speech bubbles & FX) as standalone high-res social carousel cards'
  ),
  exportCardsBtn: pickComicBi(
    `导出分格切图 (${page.value.panels.length}张)`, // cjk-ok
    `Export Cards (${page.value.panels.length})`
  ),
  exportStripTitle: pickComicBi(
    '将当前画布全部漫画页按顺序纵向拼接导出为一张整话长条漫 PNG', // cjk-ok
    'Stitch all comic pages in this graph into a single Webtoon long-strip PNG'
  ),
  exportStripBtn: pickComicBi(
    `导出整话长图 (${allGraphComicPages.value.length}页)`, // cjk-ok
    `Export Long Strip (${allGraphComicPages.value.length}p)`
  ),
  aiStorySynopsisPlaceholder: pickComicBi(
    '输入剧情（如：雨夜天台，黑衣剑客拔刀迎战机械巨龙，两人激烈交锋），一键生成分镜、台词与拟声词…', // cjk-ok
    'Describe the scene to auto-generate layout, shot prompts, dialogue bubbles & SFX…'
  ),
  batchGenPanelsTitle: pickComicBi(
    '按各分镜格构图描述与宽高比并发生成全页画面（自动继承角色定妆参考图）', // cjk-ok
    'Batch generate images for all panels on this page with character consistency'
  ),
  translatingComicLabel: pickComicBi(
    '🌐 正在 AI 译制台词与自适应排版…', // cjk-ok
    '🌐 Translating dialogue & layout…'
  ),
  translateComicHeader: pickComicBi(
    '🌐 一键漫画出海多语种译制（自动切换日漫竖排 / 欧美横排）', // cjk-ok
    '🌐 One-Click AI Comic Localization (Auto Vertical/Horizontal)'
  ),
  panelAiPromptPlaceholder: pickComicBi(
    '输入画面描述，一键生图/重绘此格…', // cjk-ok
    'Describe shot to generate/redraw…'
  ),
  panelAiGenTitle: pickComicBi(
    '按当前分格宽高比与角色参考图直接生成或重绘此格画面', // cjk-ok
    'Generate or redraw this panel matching its aspect ratio and character reference'
  ),
  popOutFrameTitle: pickComicBi(
    '将前景抠图人物叠加绘制在分镜框线之上，形成王道日漫/国漫“破框出格”立体冲击感', // cjk-ok
    'Render foreground character above panel border for 3D pop-out frame-breaking effect'
  )
}))

const page = ref<ComicPage>(createComicPage())
const dirty = ref(false)
const selectedPanelId = ref<string | null>(null)
const selectedBubbleId = ref<string | null>(null)

/** 左侧抽屉标签页与模板分类 */
const leftTab = ref<'templates' | 'bubbles'>('templates')
const templateCategory = ref<'all' | 'manga' | 'action' | 'strip' | 'grid'>('all')

const templateCategories = computed(() => [
  { id: 'all' as const, label: pickComicBi('全部', 'All') },
  { id: 'manga' as const, label: pickComicBi('日漫叙事', 'Manga') },
  { id: 'action' as const, label: pickComicBi('热血斜切', 'Action') },
  { id: 'strip' as const, label: pickComicBi('四格/条漫', 'Strip') },
  { id: 'grid' as const, label: pickComicBi('标准宫格', 'Grid') }
])

const filteredTemplates = computed(() => {
  if (templateCategory.value === 'all') return COMIC_LAYOUT_TEMPLATES
  return COMIC_LAYOUT_TEMPLATES.filter((item) => item.category === templateCategory.value)
})

function templatePreviewPolygons(tpl: ComicLayoutTemplate): string[] {
  const dummyPage = normalizeComicPage({
    ...tpl.page,
    panels: tpl.page.panels.map((p, idx) => ({
      ...p,
      id: `tpl-${idx}`,
      bubbles: []
    }))
  })
  const rMap = comicPanelRects(dummyPage)
  return dummyPage.panels.map((p) => {
    const r = rMap.get(p.id)
    if (!r) return ''
    return comicPanelPolygon(r, p)
      .map((pt) => `${pt.x},${pt.y}`)
      .join(' ')
  })
}

const pageSizePresets = computed(() => [
  { label: pickComicBi('日漫 B5 (1080×1520)', 'Manga B5'), width: 1080, height: 1520 },
  { label: pickComicBi('标准页 (1080×1440)', 'Standard 3:4'), width: 1080, height: 1440 },
  { label: pickComicBi('条漫长图 (1080×3200)', 'Webtoon'), width: 1080, height: 3200 },
  { label: pickComicBi('宽银幕 (1440×1080)', 'Landscape 4:3'), width: 1440, height: 1080 }
])

type ComicLocaleTargetId = 'ja' | 'en' | 'ko' | 'zh'
const comicLocaleTargets = computed<Array<{ id: ComicLocaleTargetId; label: string }>>(() => [
  { id: 'ja', label: pickComicBi('🇯🇵 日漫竖排 (日本語)', '🇯🇵 Japanese (Vert)') },
  { id: 'en', label: pickComicBi('🇺🇸 美漫横排 (English)', '🇺🇸 English') },
  { id: 'ko', label: pickComicBi('🇰🇷 韩漫条漫 (한국어)', '🇰🇷 Korean') },
  { id: 'zh', label: pickComicBi('🇨🇳 国漫中文 (简体)', '🇨🇳 Chinese') }
])

const slantPresets = computed<Array<{ id: ComicPanelSlantPreset; label: string }>>(() => [
  { id: 'none', label: pickComicBi('正交复位', 'Rect') },
  { id: 'slash-left', label: pickComicBi('左斜切 /', 'Slash /') },
  { id: 'slash-right', label: pickComicBi('右斜切 \\', 'Slash \\') },
  { id: 'trapezoid-top', label: pickComicBi('下斜刀口', 'Bottom Cut') },
  { id: 'trapezoid-bottom', label: pickComicBi('上斜刀口', 'Top Cut') },
  { id: 'parallelogram-left', label: pickComicBi('平行斜格', 'Skew') }
])

const filterOptions = computed<Array<{ id: ComicPanelFilter; label: string }>>(() => [
  { id: 'none', label: pickComicBi('原色', 'Original') },
  { id: 'manga-bw', label: pickComicBi('黑白日漫', 'Manga B&W') },
  { id: 'halftone', label: pickComicBi('漫画网点', 'Halftone') },
  { id: 'dramatic', label: pickComicBi('暗调反差', 'Dramatic') },
  { id: 'sepia', label: pickComicBi('回忆泛黄', 'Sepia') }
])

const effectOptions = computed<Array<{ id: ComicPanelEffectType; label: string }>>(() => [
  { id: 'none', label: pickComicBi('无特效', 'None') },
  { id: 'focus-lines', label: pickComicBi('⚡ 集中线', '⚡ Focus Lines') },
  { id: 'speed-lines', label: pickComicBi('💨 速度线', '💨 Speed Lines') },
  { id: 'vignette', label: pickComicBi('🌑 情绪暗角', '🌑 Vignette') },
  { id: 'halftone-frame', label: pickComicBi('🏁 网点气氛', '🏁 Screentone') }
])

const cameraMotionOptions = computed<Array<{ id: ComicPanelCameraMotion; label: string }>>(() => [
  { id: 'auto', label: pickComicBi('✨ 自动推算', '✨ Auto') },
  { id: 'kenBurnsIn', label: pickComicBi('🔍 推镜特写', '🔍 Zoom In') },
  { id: 'kenBurnsOut', label: pickComicBi('🔭 拉镜全景', '🔭 Zoom Out') },
  { id: 'panRight', label: pickComicBi('➡ 右摇平移', '➡ Pan Right') },
  { id: 'panLeft', label: pickComicBi('⬅ 左摇平移', '⬅ Pan Left') },
  { id: 'panDown', label: pickComicBi('⬇ 下摇条漫', '⬇ Pan Down') },
  { id: 'panUp', label: pickComicBi('⬆ 上摇仰视', '⬆ Pan Up') },
  { id: 'none', label: pickComicBi('⏸ 静止定格', '⏸ Static') }
])

const bubbleShapes = computed<Array<{ id: ComicBubbleShape; label: string }>>(() => [
  { id: 'rounded', label: pickComicBi('💬 圆角框', 'Rounded') },
  { id: 'oval', label: pickComicBi('🥚 日漫椭圆', 'Manga Oval') },
  { id: 'shout', label: pickComicBi('💥 爆炸呐喊', 'Shout Burst') },
  { id: 'thought', label: pickComicBi('💭 云朵心理', 'Thought Cloud') },
  { id: 'narration', label: pickComicBi('📝 旁白方框', 'Narration') },
  { id: 'sfx', label: pickComicBi('🔊 拟声词字', 'SFX Text') }
])

interface BubblePresetItem {
  id: string
  icon: string
  label: string
  shape: ComicBubbleShape
  writingMode: ComicBubbleWritingMode
  text: string
  scale?: number
}

const bubbleShapePresets = computed<BubblePresetItem[]>(() => [
  {
    id: 'manga-vert',
    icon: '🥚',
    label: pickComicBi('日漫竖排对白', 'Vertical Manga'),
    shape: 'oval',
    writingMode: 'vertical-rl',
    text: pickComicBi('终于等到你了！', 'Finally here!')
  },
  {
    id: 'round-horz',
    icon: '💬',
    label: pickComicBi('现代横排对白', 'Modern Dialogue'),
    shape: 'rounded',
    writingMode: 'horizontal-tb',
    text: pickComicBi('我们出发吧。', "Let's move out.")
  },
  {
    id: 'shout-burst',
    icon: '💥',
    label: pickComicBi('咆哮爆炸框', 'Explosive Shout'),
    shape: 'shout',
    writingMode: 'horizontal-tb',
    text: pickComicBi('小心身后！！', 'WATCH OUT!!'),
    scale: 1.2
  },
  {
    id: 'thought-cloud',
    icon: '💭',
    label: pickComicBi('内心独白框', 'Inner Thought'),
    shape: 'thought',
    writingMode: 'horizontal-tb',
    text: pickComicBi('难道说…那个人是…', 'Could it be…')
  },
  {
    id: 'narration-box',
    icon: '📝',
    label: pickComicBi('旁白解说方框', 'Narration Box'),
    shape: 'narration',
    writingMode: 'horizontal-tb',
    text: pickComicBi('那一夜，无人知晓真相。', 'That night, nobody knew the truth.')
  },
  {
    id: 'dark-shout',
    icon: '🖤',
    label: pickComicBi('黑底威压台词', 'Dark Impact'),
    shape: 'shout',
    writingMode: 'vertical-rl',
    text: pickComicBi('绝不饶恕！', 'UNFORGIVABLE!')
  }
])

interface SfxPresetItem {
  text: string
  desc: string
  color: string
  rotation: number
  writingMode?: ComicBubbleWritingMode
}

const sfxPresets = computed<SfxPresetItem[]>(() => [
  {
    text: pickComicBi('轰隆隆!!', 'BOOM!!'),
    desc: pickComicBi('爆炸/巨响', 'Explosion'),
    color: '#e11d48',
    rotation: -12
  },
  {
    text: pickComicBi('咔嚓！', 'SLASH!'),
    desc: pickComicBi('斩击/碎裂', 'Slash'),
    color: '#0284c7',
    rotation: -18
  },
  {
    text: pickComicBi('嗖——！', 'WHOOSH!'),
    desc: pickComicBi('高速疾驰', 'Dash'),
    color: '#2563eb',
    rotation: 10
  },
  {
    text: pickComicBi('咚！！', 'DOOM!!'),
    desc: pickComicBi('震撼登场', 'Impact'),
    color: '#111111',
    rotation: -8,
    writingMode: 'vertical-rl'
  },
  { text: '！？', desc: pickComicBi('震惊/疑问', 'Shock'), color: '#dc2626', rotation: 12 },
  {
    text: pickComicBi('啪！！', 'SMACK!!'),
    desc: pickComicBi('打击/拍桌', 'Strike'),
    color: '#ea580c',
    rotation: -14
  },
  {
    text: pickComicBi('ドキドキ', 'THUMP'),
    desc: pickComicBi('心跳加速', 'Heartbeat'),
    color: '#db2777',
    rotation: -6
  },
  {
    text: pickComicBi('嘶——', 'GASP!'),
    desc: pickComicBi('倒吸凉气', 'Gasp'),
    color: '#4f46e5',
    rotation: 8
  }
])

/** 撤销 / 重做历史栈 */
const historyPast = ref<string[]>([])
const historyFuture = ref<string[]>([])
const MAX_HISTORY = 50
const canUndo = computed(() => historyPast.value.length > 0)
const canRedo = computed(() => historyFuture.value.length > 0)

function pushHistorySnapshot(snapshotJson: string): void {
  const last = historyPast.value[historyPast.value.length - 1]
  if (last === snapshotJson) return
  historyPast.value.push(snapshotJson)
  if (historyPast.value.length > MAX_HISTORY) historyPast.value.shift()
  historyFuture.value = []
}

function undo(): void {
  if (!historyPast.value.length) return
  const currentJson = serializeComicPage(page.value)
  const prevJson = historyPast.value.pop()!
  historyFuture.value.push(currentJson)
  const parsed = parseComicPage(prevJson)
  if (parsed) {
    page.value = parsed
    dirty.value = true
    persist()
  }
}

function redo(): void {
  if (!historyFuture.value.length) return
  const currentJson = serializeComicPage(page.value)
  const nextJson = historyFuture.value.pop()!
  historyPast.value.push(currentJson)
  const parsed = parseComicPage(nextJson)
  if (parsed) {
    page.value = parsed
    dirty.value = true
    persist()
  }
}

const node = computed(() => graphEditorHosts.getNode(props.hostId, activeNodeId.value))
const exportName = computed(() => (node.value?.title || t('graph.types.comic.page')).trim())

const selectedPanel = computed(
  () => page.value.panels.find((item) => item.id === selectedPanelId.value) ?? null
)
const selectedBubble = computed(() => {
  if (!selectedPanel.value || !selectedBubbleId.value) return null
  return selectedPanel.value.bubbles.find((item) => item.id === selectedBubbleId.value) ?? null
})

const showGlobal = computed(() => !selectedPanel.value && !selectedBubble.value)

function cssHexOrFallback(raw: string | null | undefined, fallback = '#ffffff'): string {
  const value = raw?.trim() ?? ''
  return /^#[0-9a-f]{6}$/i.test(value) ? value : fallback
}
const pageBgHex = computed(() => cssHexOrFallback(page.value.backgroundColor, '#ffffff'))
const pageBorderHex = computed(() => cssHexOrFallback(page.value.borderColor, '#111111'))
const panelBgHex = computed(() => cssHexOrFallback(selectedPanel.value?.backgroundColor, '#f2f2f2'))

const incomingImages = computed(() => {
  void graphEditorHosts.revision.value
  const edges = [
    ...graphEditorHosts.listIncomingEdges(props.hostId, activeNodeId.value, 'in-image'),
    ...graphEditorHosts.listIncomingEdges(props.hostId, activeNodeId.value, 'in')
  ]
  const seen = new Set<string>()
  const items: Array<{ label: string; url: string }> = []
  const push = (label: string, url: string): void => {
    const next = url.trim()
    if (!next || seen.has(next)) return
    seen.add(next)
    items.push({ label, url: next })
  }
  for (const edge of edges) {
    const source = graphEditorHosts.getNode(props.hostId, edge.sourceNodeId)
    if (!source) continue
    const title = source.title?.trim() || source.typeId
    const preview = source.params.previewRelativePath?.trim()
    if (preview) push(`${title} #${edge.index}`, preview)
    for (const image of source.params.generatedImages ?? []) {
      push(`${title}`, image.relativePath?.trim() || image.dataUrl?.trim() || '')
    }
  }
  return items
})

const graphComicPageNodes = computed<Array<{ id: string; shortLabel: string; title: string }>>(
  () => {
    void graphEditorHosts.revision.value
    const doc = graphEditorHosts.getDocument(props.hostId)
    if (!doc) return []
    const comicNodes = doc.nodes
      .filter((n) => n.typeId === 'comic.page')
      .slice()
      .sort((a, b) => {
        const dy = (a.position?.y ?? 0) - (b.position?.y ?? 0)
        if (Math.abs(dy) > 40) return dy
        const dx = (a.position?.x ?? 0) - (b.position?.x ?? 0)
        if (Math.abs(dx) > 40) return dx
        return a.id.localeCompare(b.id)
      })
    return comicNodes.map((n, idx) => {
      const p = n.id === activeNodeId.value ? page.value : readComicPageFromGenParams(n.params)
      const title = p?.title?.trim() || n.title?.trim() || `Page ${idx + 1}`
      return {
        id: n.id,
        shortLabel: `P${idx + 1}`,
        title
      }
    })
  }
)

function switchActiveComicPageNode(targetNodeId: string): void {
  if (!targetNodeId || targetNodeId === activeNodeId.value) return
  persist()
  activeNodeId.value = targetNodeId
  selectedPanelId.value = null
  selectedBubbleId.value = null
  historyPast.value = []
  historyFuture.value = []
  load()
  void nextTick(() => canvasRef.value?.fitToViewport())
}

const allGraphComicPages = computed<ComicPage[]>(() => {
  void graphEditorHosts.revision.value
  const doc = graphEditorHosts.getDocument(props.hostId)
  if (!doc) return page.value.panels.length ? [page.value] : []
  const comicNodes = doc.nodes
    .filter((n) => n.typeId === 'comic.page')
    .slice()
    .sort((a, b) => {
      const dy = (a.position?.y ?? 0) - (b.position?.y ?? 0)
      if (Math.abs(dy) > 40) return dy
      const dx = (a.position?.x ?? 0) - (b.position?.x ?? 0)
      if (Math.abs(dx) > 40) return dx
      return a.id.localeCompare(b.id)
    })
  const pages: ComicPage[] = []
  for (const n of comicNodes) {
    const p =
      n.id === activeNodeId.value
        ? page.value
        : (readComicPageFromGenParams(n.params) ?? createComicPage())
    if (p.panels.length > 0) pages.push(p)
  }
  return pages
})

async function onExportStitchedStrip(): Promise<void> {
  if (exportingStitchedStrip.value || allGraphComicPages.value.length === 0) return
  exportingStitchedStrip.value = true
  try {
    persist()
    const result = await composeStitchedComicStripImage({
      pages: allGraphComicPages.value,
      resolveImage: resolvePanelImageDataUrl
    })
    const match = result.dataUrl.match(/^data:[^;,]+(;base64)?,([\s\S]*)$/i)
    if (!match) return
    const isBase64 = Boolean(match[1])
    const binary = isBase64 ? atob(match[2]!) : decodeURIComponent(match[2]!)
    const data = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) data[i] = binary.charCodeAt(i)
    const rawTitle = page.value.title?.trim() || node.value?.title?.trim() || 'comic-strip'
    const safeName =
      rawTitle
        .replace(/[\\/:*?"<>|]+/g, '-')
        .replace(/\.+$/, '')
        .trim() || 'comic-strip'
    await window.studio.saveBinaryFilesToDirectory({
      files: [{ fileName: `${safeName}-long-strip-${result.pageCount}p.png`, data }]
    })
  } finally {
    exportingStitchedStrip.value = false
  }
}

async function onExportPanelCardsPack(): Promise<void> {
  if (exportingPanelCards.value || page.value.panels.length === 0) return
  exportingPanelCards.value = true
  try {
    persist()
    const cards = await composeComicPanelCardsPack({
      page: page.value,
      resolveImage: resolvePanelImageDataUrl
    })
    if (!cards.length) return
    const rawPageTitle = page.value.title?.trim() || node.value?.title?.trim() || 'comic'
    const safePrefix =
      rawPageTitle
        .replace(/[\\/:*?"<>|]+/g, '-')
        .replace(/\.+$/, '')
        .trim() || 'comic'
    const files: Array<{ fileName: string; data: Uint8Array }> = []
    for (const card of cards) {
      const match = card.dataUrl.match(/^data:[^;,]+(;base64)?,([\s\S]*)$/i)
      if (!match) continue
      const isBase64 = Boolean(match[1])
      const binary = isBase64 ? atob(match[2]!) : decodeURIComponent(match[2]!)
      const data = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) data[i] = binary.charCodeAt(i)
      const numStr = String(card.index).padStart(2, '0')
      const safeCardTitle =
        card.title
          .replace(/[\\/:*?"<>|]+/g, '-')
          .replace(/\.+$/, '')
          .trim() || `panel-${numStr}`
      files.push({
        fileName: `${safePrefix}-${numStr}-${safeCardTitle}.png`,
        data
      })
    }
    if (files.length > 0) {
      await window.studio.saveBinaryFilesToDirectory({ files })
    }
  } finally {
    exportingPanelCards.value = false
  }
}

function load(): void {
  const current = node.value
  page.value = readComicPageFromGenParams(current?.params) ?? createComicPage()
  dirty.value = false
}

watch(
  () => props.nodeId,
  (nextId) => {
    if (nextId && nextId !== activeNodeId.value) {
      persist()
      activeNodeId.value = nextId
      selectedPanelId.value = null
      selectedBubbleId.value = null
      historyPast.value = []
      historyFuture.value = []
      load()
    }
  }
)

watch(
  () => [props.hostId, activeNodeId.value, graphEditorHosts.revision.value] as const,
  () => {
    if (dirty.value) return
    load()
  },
  { immediate: true }
)

/** 拖拽过程中的起始快照（用于在 edit-end 时记录单步 Undo） */
const dragStartSnapshot = ref<string | null>(null)

function commit(next: ComicPage, options?: { persist?: boolean; recordHistory?: boolean }): void {
  const persistNow = options?.persist !== false
  const recordHistory = options?.recordHistory ?? persistNow
  if (recordHistory) {
    pushHistorySnapshot(serializeComicPage(page.value))
    dragStartSnapshot.value = null
  } else if (dragStartSnapshot.value === null) {
    dragStartSnapshot.value = serializeComicPage(page.value)
  }

  page.value = next
  dirty.value = true
  if (selectedPanelId.value && !next.panels.some((item) => item.id === selectedPanelId.value)) {
    selectedPanelId.value = null
    selectedBubbleId.value = null
  }
  if (persistNow) persist()
}

function onCanvasEditEnd(): void {
  if (dragStartSnapshot.value !== null) {
    pushHistorySnapshot(dragStartSnapshot.value)
    dragStartSnapshot.value = null
  }
  persist()
}

function persist(): void {
  if (!dirty.value) return
  const parsed = parseComicPage(serializeComicPage(page.value))
  if (!parsed) return
  graphEditorHosts.updateNode(props.hostId, activeNodeId.value, {
    comicPage: serializeComicPage(parsed)
  })
  dirty.value = false
}

useEditorDiveFrameFlush(() => props.frameKey, persist)

function onClose(): void {
  persist()
  if (!editorDive) return
  const idx = editorDive.frames.findIndex((frame) => frame.key === props.frameKey)
  editorDive.popTo(idx < 0 ? -1 : idx - 1)
}

function onApplyTemplate(templateId: string): void {
  const next = applyComicLayoutTemplate(page.value, templateId)
  commit(next)
  selectedPanelId.value = next.panels[0]?.id ?? null
  selectedBubbleId.value = null
  void nextTick(() => canvasRef.value?.fitToViewport())
}

function applyPageSizePreset(width: number, height: number): void {
  commit(withComicPageLayout(page.value, { width, height }))
  void nextTick(() => canvasRef.value?.fitToViewport())
}

function applyPageGenrePreset(genre: 'manga-bw' | 'halftone' | 'webtoon' | 'color-action'): void {
  const cur = normalizeComicPage(page.value)
  if (genre === 'manga-bw') {
    const nextPanels = cur.panels.map((p) => ({
      ...p,
      imageFilter: 'manga-bw' as const,
      bubbles: p.bubbles.map((b) =>
        b.shape === 'narration'
          ? b
          : {
              ...b,
              writingMode: 'vertical-rl' as const,
              shape: b.shape === 'rounded' || !b.shape ? ('oval' as const) : b.shape
            }
      )
    }))
    commit(
      normalizeComicPage({
        ...cur,
        readingDirection: 'rtl',
        backgroundColor: '#ffffff',
        borderColor: '#111111',
        borderWidth: 3,
        borderRadius: 0,
        padding: cur.padding || 36,
        panels: nextPanels
      })
    )
  } else if (genre === 'halftone') {
    const nextPanels = cur.panels.map((p) => ({
      ...p,
      imageFilter: 'halftone' as const
    }))
    commit(
      normalizeComicPage({
        ...cur,
        backgroundColor: '#faf8f5',
        borderColor: '#1a1a1a',
        borderWidth: 2.5,
        panels: nextPanels
      })
    )
  } else if (genre === 'webtoon') {
    const ordered = readingOrderPanels(cur)
    const totalRows = Math.max(4, ordered.length * 2)
    const nextPanels = ordered.map((p, idx) => ({
      ...p,
      row: idx * 2,
      col: 0,
      rowSpan: 2,
      colSpan: 1,
      cornerOffsets: undefined,
      imageFilter: undefined,
      bubbles: p.bubbles.map((b) => ({ ...b, writingMode: 'horizontal-tb' as const }))
    }))
    commit(
      normalizeComicPage({
        ...cur,
        width: 1080,
        height: Math.max(2200, ordered.length * 640),
        columns: 1,
        rows: totalRows,
        gutter: 36,
        padding: 40,
        readingDirection: 'ltr',
        backgroundColor: '#ffffff',
        borderWidth: 2,
        borderColor: '#111111',
        panels: nextPanels
      })
    )
    void nextTick(() => canvasRef.value?.fitToViewport())
  } else if (genre === 'color-action') {
    const nextPanels = cur.panels.map((p) => ({
      ...p,
      imageFilter: undefined,
      bubbles: p.bubbles.map((b) => ({ ...b, writingMode: 'horizontal-tb' as const }))
    }))
    commit(
      normalizeComicPage({
        ...cur,
        readingDirection: 'ltr',
        backgroundColor: '#0f172a',
        borderColor: '#111111',
        borderWidth: 3,
        panels: nextPanels
      })
    )
  }
}

async function onGenerateAiPageStoryboard(): Promise<void> {
  const synopsis = aiPageStoryPrompt.value.trim()
  if (!synopsis || generatingAiStoryboard.value) return
  generatingAiStoryboard.value = true
  try {
    const templateIds = COMIC_LAYOUT_TEMPLATES.map(
      (tpl) => `${tpl.id} (${tpl.page.panels.length} panels: ${tpl.name.zh})`
    ).join(', ')
    const systemPrompt = [
      'You are a master comic / manga storyboard director and scriptwriter.',
      'Given a scene synopsis, choose the best layout template and output ONLY valid JSON (no markdown fences) with this exact structure:',
      '{"templateId":"manga-standard-5","title":"Optional short header","panels":[{"title":"Detailed visual shot prompt for image generation (character appearance, pose, camera angle, background, lighting, NO text/bubbles)","caption":"Optional narration caption","effectType":"none|focus-lines|speed-lines|vignette|halftone-frame","cameraMotion":"auto|kenBurnsIn|kenBurnsOut|panRight|panLeft","bubbles":[{"speaker":"Character Name","text":"Short punchy comic dialogue or SFX","shape":"oval|rounded|shout|thought|narration|sfx"}]}]}',
      `Available templateIds: ${templateIds}. Match the number of panels in your JSON to the chosen template's panel count.`
    ].join('\n')
    const res = await window.studio.generateText({
      prompt: synopsis,
      system: systemPrompt
    })
    const raw = (res?.text ?? '')
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim()
    if (!raw) return
    const firstBrace = raw.indexOf('{')
    const lastBrace = raw.lastIndexOf('}')
    const jsonSlice =
      firstBrace >= 0 && lastBrace > firstBrace ? raw.slice(firstBrace, lastBrace + 1) : raw
    const parsed = JSON.parse(jsonSlice) as {
      templateId?: string
      title?: string
      panels?: Array<{
        title?: string
        caption?: string
        effectType?: ComicPanelEffectType
        cameraMotion?: ComicPanelCameraMotion
        bubbles?: Array<{
          speaker?: string
          text?: string
          shape?: ComicBubbleShape
        }>
      }>
    }
    const chosenTplId =
      parsed.templateId && COMIC_LAYOUT_TEMPLATES.some((t) => t.id === parsed.templateId)
        ? parsed.templateId
        : (COMIC_LAYOUT_TEMPLATES[0]?.id ?? 'manga-standard-5')
    let next = applyComicLayoutTemplate(page.value, chosenTplId)
    if (parsed.title?.trim()) {
      next = withComicPageLayout(next, { title: parsed.title.trim() })
    }
    const isRtl = next.readingDirection === 'rtl'
    const ordered = readingOrderPanels(next)
    const aiPanels = Array.isArray(parsed.panels) ? parsed.panels : []
    const patchedById = new Map<string, ComicPanel>()
    ordered.forEach((p, idx) => {
      const spec = aiPanels[idx]
      if (!spec) return
      const bubbles: ComicSpeechBubble[] = []
      const rawBubbles = Array.isArray(spec.bubbles) ? spec.bubbles : []
      let dlgIdx = 0
      rawBubbles.forEach((b, bIdx) => {
        const text = b.text?.trim()
        if (!text) return
        const shape: ComicBubbleShape = b.shape ?? 'oval'
        const isSfx = shape === 'sfx'
        const x = isSfx ? 0.72 : dlgIdx === 0 ? (isRtl ? 0.74 : 0.26) : isRtl ? 0.28 : 0.72
        const y = isSfx ? 0.74 : dlgIdx === 0 ? 0.22 : 0.36
        if (!isSfx) dlgIdx++
        bubbles.push({
          id: `${p.id}-b-${bIdx + 1}`,
          text,
          ...(b.speaker?.trim() ? { speaker: b.speaker.trim() } : {}),
          x,
          y,
          tail: x >= 0.5 ? 'bl' : 'br',
          shape,
          writingMode: isRtl && shape !== 'narration' ? 'vertical-rl' : 'horizontal-tb',
          ...(isSfx
            ? {
                textColor: '#e11d48',
                backgroundColor: '#ffffff',
                borderColor: '#111111',
                fontWeight: 'black' as const,
                rotation: -10,
                scale: 1.25
              }
            : {})
        })
      })
      patchedById.set(p.id, {
        ...p,
        ...(spec.title?.trim() ? { title: spec.title.trim() } : {}),
        ...(spec.caption?.trim() ? { caption: spec.caption.trim() } : {}),
        ...(spec.effectType && spec.effectType !== 'none' ? { effectType: spec.effectType } : {}),
        ...(spec.cameraMotion && spec.cameraMotion !== 'auto'
          ? { cameraMotion: spec.cameraMotion }
          : {}),
        bubbles: bubbles.length > 0 ? bubbles : p.bubbles
      })
    })
    next = normalizeComicPage({
      ...next,
      panels: next.panels.map((p) => patchedById.get(p.id) ?? p)
    })
    commit(next)
    selectedPanelId.value = null
    selectedBubbleId.value = null
    void nextTick(() => canvasRef.value?.fitToViewport())
  } catch {
    // ignore storyboard generation failure when LLM is unconfigured or returns invalid JSON
  } finally {
    generatingAiStoryboard.value = false
  }
}

async function onGenerateAllPanelsImages(): Promise<void> {
  const currentNode = node.value
  if (!currentNode || generatingAllPanelImages.value || page.value.panels.length === 0) return
  generatingAllPanelImages.value = true
  try {
    const ordered = readingOrderPanels(page.value)
    const emptyTargets = ordered.filter((p) => !p.imageUrl?.trim())
    const targets = emptyTargets.length > 0 ? emptyTargets : ordered
    const rects = comicPanelRects(page.value)

    // 收集画布上游角色定妆图或当前页已有首图作为一致性参考
    let sharedRefDataUrl = ''
    const firstIncoming = incomingImages.value[0]?.url
    const existingPanelUrl = page.value.panels.find((p) => p.imageUrl?.trim())?.imageUrl
    const refCandidate = firstIncoming || existingPanelUrl || ''
    if (refCandidate) {
      sharedRefDataUrl = await resolvePanelImageDataUrl(refCandidate)
    }

    const concurrency = 2
    for (let i = 0; i < targets.length; i += concurrency) {
      const batch = targets.slice(i, i + concurrency)
      await Promise.all(
        batch.map(async (panel, bIdx) => {
          const shotDesc =
            panel.title?.trim() ||
            panel.caption?.trim() ||
            panel.bubbles
              .map((b) => b.text)
              .join(' ')
              .trim() ||
            aiPageStoryPrompt.value.trim() ||
            `Comic storyboard shot #${i + bIdx + 1}`
          const rect = rects.get(panel.id)
          const ratio = rect && rect.height > 0 ? rect.width / rect.height : 1
          const aspectRatio =
            ratio > 1.45 ? '16:9' : ratio > 1.15 ? '4:3' : ratio < 0.78 ? '2:3' : '1:1'
          const fullPrompt = `${shotDesc}，严格保持漫画画风与角色形象一致；整张图只画这一幅独立分镜画面，禁止绘制漫画分格线、禁止任何台词气泡与文字` // cjk-ok
          try {
            const genRes = await window.studio.generateImage({
              prompt: fullPrompt,
              aspectRatio,
              ...(sharedRefDataUrl ? { inputReferences: [sharedRefDataUrl] } : {})
            })
            const imgDataUrl = genRes?.images?.[0]?.trim() || ''
            if (!imgDataUrl) return
            if (!sharedRefDataUrl) sharedRefDataUrl = imgDataUrl
            let savedRel = imgDataUrl
            if (project.isOpen) {
              const persisted = await saveGraphRunMediaForNode({
                dataUrl: imgDataUrl,
                key: `comicPanelBatch:${activeNodeId.value}:${panel.id}:${Date.now().toString(36)}`,
                node: currentNode,
                hostAssetId: hostAssetId.value || null,
                kind: 'image'
              })
              if (persisted?.trim()) savedRel = persisted.trim()
            }
            const latestPanel = page.value.panels.find((p) => p.id === panel.id)
            if (latestPanel) {
              commit(upsertComicPanel(page.value, { ...latestPanel, imageUrl: savedRel }))
            }
          } catch {
            // ignore individual panel failure
          }
        })
      )
    }
  } finally {
    generatingAllPanelImages.value = false
  }
}

async function onTranslateComicPage(targetLang: ComicLocaleTargetId): Promise<void> {
  if (translatingComicPage.value || page.value.panels.length === 0) return
  if (typeof window === 'undefined' || typeof window.studio?.generateText !== 'function') return

  const items: Array<{
    key: string
    kind: 'pageTitle' | 'caption' | 'bubble' | 'sfx'
    speaker?: string
    text: string
  }> = []
  if (page.value.title?.trim()) {
    items.push({ key: 'page:title', kind: 'pageTitle', text: page.value.title.trim() })
  }
  for (const panel of page.value.panels) {
    if (panel.caption?.trim()) {
      items.push({
        key: `panel:${panel.id}:caption`,
        kind: 'caption',
        text: panel.caption.trim()
      })
    }
    for (const b of panel.bubbles) {
      if (!b.text?.trim()) continue
      items.push({
        key: `bubble:${panel.id}:${b.id}`,
        kind: b.shape === 'sfx' ? 'sfx' : 'bubble',
        ...(b.speaker?.trim() ? { speaker: b.speaker.trim() } : {}),
        text: b.text.trim()
      })
    }
  }
  if (items.length === 0) return

  translatingComicPage.value = true
  try {
    const langSpec: Record<ComicLocaleTargetId, string> = {
      ja: 'Natural Japanese manga dialogue & katakana/hiragana onomatopoeia (日本語・漫画台詞と擬音語)', // cjk-ok
      en: 'Punchy American comic book English dialogue & classic comic SFX (e.g., BOOM!, SLASH!, WHOOSH!)',
      ko: 'Natural Korean webtoon dialogue & Korean SFX (한국어 웹툰 대사 및 효과음)',
      zh: '地道国漫简体中文台词与中文拟声词（如：轰！、斩！、嗖——）' // cjk-ok
    }
    const sys = [
      'You are a professional manga/comic localization translator and letterer.',
      `Translate the provided comic page text items into: ${langSpec[targetLang]}.`,
      'Keep translations concise so they fit neatly inside comic speech bubbles.',
      'Return ONLY valid JSON without markdown fences in this exact schema:',
      '{"translations":[{"key":"string","speaker":"translated speaker if present","text":"translated text"}]}'
    ].join('\n')

    const res = await window.studio.generateText({
      prompt: JSON.stringify({ targetLanguage: targetLang, items }),
      system: sys
    })
    const rawText = (res?.text ?? '').trim()
    const jsonMatch = rawText.match(/\{[\s\S]*\}/)
    const parsed = jsonMatch
      ? (JSON.parse(jsonMatch[0]) as {
          translations?: Array<{ key?: string; speaker?: string; text?: string }>
        })
      : null
    const map = new Map<string, { speaker?: string; text: string }>()
    for (const tItem of parsed?.translations ?? []) {
      const k = tItem.key?.trim()
      const txt = tItem.text?.trim()
      if (k && txt) {
        map.set(k, {
          ...(tItem.speaker?.trim() ? { speaker: tItem.speaker.trim() } : {}),
          text: txt
        })
      }
    }
    if (map.size === 0) return

    const isJa = targetLang === 'ja'
    const targetWritingMode: ComicBubbleWritingMode = isJa ? 'vertical-rl' : 'horizontal-tb'
    const nextTitle = map.get('page:title')?.text ?? page.value.title

    const nextPanels: ComicPanel[] = page.value.panels.map((panel) => {
      const capHit = map.get(`panel:${panel.id}:caption`)
      const nextBubbles: ComicSpeechBubble[] = panel.bubbles.map((b) => {
        const bHit = map.get(`bubble:${panel.id}:${b.id}`)
        const isSfx = b.shape === 'sfx'
        return {
          ...b,
          ...(bHit?.text ? { text: bHit.text } : {}),
          ...(bHit?.speaker ? { speaker: bHit.speaker } : {}),
          ...(isSfx ? {} : { writingMode: targetWritingMode })
        }
      })
      return {
        ...panel,
        ...(capHit?.text ? { caption: capHit.text } : {}),
        bubbles: nextBubbles
      }
    })

    commit(
      normalizeComicPage({
        ...page.value,
        ...(nextTitle ? { title: nextTitle } : {}),
        readingDirection: isJa ? 'rtl' : 'ltr',
        panels: nextPanels
      })
    )
  } catch {
    // ignore translation parse failure
  } finally {
    translatingComicPage.value = false
  }
}

let animaticSessionId = 0
let activeAnimaticAudio: HTMLAudioElement | null = null

function stopAnimaticPreview(restoreViewport = true): void {
  animaticSessionId += 1
  animaticPlaying.value = false
  if (activeAnimaticAudio) {
    try {
      activeAnimaticAudio.pause()
      activeAnimaticAudio.src = ''
    } catch {
      /* ignore */
    }
    activeAnimaticAudio = null
  }
  if (restoreViewport) {
    canvasRef.value?.fitToViewport(true)
  }
}

async function resolveAudioPreviewDataUrl(relativePath: string): Promise<string> {
  if (!relativePath) return ''
  if (relativePath.startsWith('data:') || /^https?:\/\//i.test(relativePath)) return relativePath
  try {
    const dataUrl = await window.studio?.getAssetMediaDataUrl?.(relativePath)
    if (dataUrl) return dataUrl
  } catch {
    /* ignore */
  }
  return ''
}

async function probeAudioDurationSec(relativePath: string): Promise<number | undefined> {
  if (typeof window === 'undefined' || typeof Audio === 'undefined' || !relativePath) {
    return undefined
  }
  const src = await resolveAudioPreviewDataUrl(relativePath)
  if (!src) return undefined
  return new Promise<number | undefined>((resolve) => {
    const audio = new Audio()
    let settled = false
    const finish = (val?: number): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      audio.onloadedmetadata = null
      audio.onerror = null
      resolve(val)
    }
    const timer = setTimeout(() => finish(undefined), 1500)
    audio.onloadedmetadata = () => {
      const dur = audio.duration
      if (Number.isFinite(dur) && dur > 0.15 && dur < 120) {
        finish(Math.round(dur * 1000) / 1000)
      } else {
        finish(undefined)
      }
    }
    audio.onerror = () => finish(undefined)
    audio.src = src
  })
}

async function playAudioAndWait(
  relativePath: string,
  fallbackSec: number,
  session: number
): Promise<void> {
  const src = await resolveAudioPreviewDataUrl(relativePath)
  if (!src || session !== animaticSessionId) {
    await new Promise((r) => setTimeout(r, Math.round(fallbackSec * 1000)))
    return
  }
  await new Promise<void>((resolve) => {
    const audio = new Audio(src)
    activeAnimaticAudio = audio
    let done = false
    const finish = (): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      if (activeAnimaticAudio === audio) activeAnimaticAudio = null
      resolve()
    }
    const timer = setTimeout(finish, Math.max(1200, Math.round((fallbackSec + 2.5) * 1000)))
    audio.onended = finish
    audio.onerror = finish
    audio.play().catch(finish)
  })
}

async function toggleAnimaticPreview(): Promise<void> {
  if (animaticPlaying.value) {
    stopAnimaticPreview(true)
    return
  }
  const ordered = readingOrderPanels(page.value)
  if (ordered.length === 0) return

  const session = ++animaticSessionId
  animaticPlaying.value = true

  // 收集时间线节点中可能已缓存的该页角色配音
  const doc = graphEditorHosts.getDocument(props.hostId)
  const cachedVoiceByBubble = new Map<string, string>()
  if (doc) {
    for (const n of doc.nodes) {
      if (n.typeId === 'output.timeline' || n.typeId === 'voice.tts') {
        for (const v of n.params?.generatedVoices ?? []) {
          const prefix = `comic-tts-${activeNodeId.value}-`
          if (v.id?.startsWith(prefix) && v.relativePath?.trim()) {
            cachedVoiceByBubble.set(v.id.slice(prefix.length), v.relativePath.trim())
          }
        }
      }
    }
  }

  try {
    for (const panel of ordered) {
      if (session !== animaticSessionId) return
      selectedPanelId.value = panel.id
      selectedBubbleId.value = null
      canvasRef.value?.focusPanelInViewport?.(panel.id)

      const bubbles = readingOrderBubbles(panel.bubbles, page.value.readingDirection).filter(
        (b) => (b.shape ?? 'rounded') !== 'sfx' && b.text.trim()
      )

      if (bubbles.length === 0) {
        const waitSec =
          panel.durationSec ?? (panel.caption ? estimateComicBubbleDurationSec(panel.caption) : 1.8)
        await new Promise((r) => setTimeout(r, Math.round(waitSec * 1000)))
      } else {
        await new Promise((r) => setTimeout(r, 260))
        for (const b of bubbles) {
          if (session !== animaticSessionId) return
          selectedBubbleId.value = b.id
          const estSec = estimateComicBubbleDurationSec(b.text)
          const voiceRel = cachedVoiceByBubble.get(b.id)
          if (voiceRel) {
            await playAudioAndWait(voiceRel, estSec, session)
          } else {
            await new Promise((r) => setTimeout(r, Math.round(estSec * 1000)))
          }
        }
      }
    }
  } finally {
    if (session === animaticSessionId) {
      stopAnimaticPreview(true)
    }
  }
}

async function onGeneratePanelImageInPlace(): Promise<void> {
  const panel = selectedPanel.value
  const currentNode = node.value
  if (!panel || !currentNode || generatingPanelImage.value) return
  const rawPrompt =
    panelAiPrompt.value.trim() ||
    panel.title?.trim() ||
    panel.caption?.trim() ||
    panel.bubbles
      .map((b) => b.text)
      .join(' ')
      .trim()
  if (!rawPrompt) return
  generatingPanelImage.value = true
  try {
    const rect = comicPanelRects(page.value).get(panel.id)
    const ratio = rect && rect.height > 0 ? rect.width / rect.height : 1
    const aspectRatio = ratio > 1.45 ? '16:9' : ratio > 1.15 ? '4:3' : ratio < 0.78 ? '2:3' : '1:1'

    // 自动收集画布上游参考图（如 charAnchor 角色定妆图或同页首张分镜图）保持画风与人物一致
    const refs: string[] = []
    if (panel.imageUrl) {
      const existingData = await resolvePanelImageDataUrl(panel.imageUrl)
      if (existingData) refs.push(existingData)
    }
    if (refs.length === 0) {
      const firstIncoming = incomingImages.value[0]?.url
      const fallbackUrl = firstIncoming || page.value.panels.find((p) => p.imageUrl)?.imageUrl || ''
      if (fallbackUrl) {
        const refData = await resolvePanelImageDataUrl(fallbackUrl)
        if (refData) refs.push(refData)
      }
    }

    const fullPrompt = `${rawPrompt}，严格保持漫画画风与角色形象一致；整张图只画这一幅独立分镜画面，禁止绘制漫画分格线、禁止任何台词气泡与文字` // cjk-ok
    const genRes = await window.studio.generateImage({
      prompt: fullPrompt,
      aspectRatio,
      ...(refs.length > 0 ? { inputReferences: refs } : {})
    })
    const imgDataUrl = genRes?.images?.[0]?.trim() || ''
    if (!imgDataUrl) return
    let savedRel = imgDataUrl
    if (project.isOpen) {
      const persisted = await saveGraphRunMediaForNode({
        dataUrl: imgDataUrl,
        key: `comicPanelGen:${activeNodeId.value}:${panel.id}:${Date.now().toString(36)}`,
        node: currentNode,
        hostAssetId: hostAssetId.value || null,
        kind: 'image'
      })
      if (persisted?.trim()) savedRel = persisted.trim()
    }
    patchSelectedPanel({ imageUrl: savedRel })
    panelAiPrompt.value = ''
  } catch {
    // ignore generation failure when model is unconfigured
  } finally {
    generatingPanelImage.value = false
  }
}

function autoFillFromIncoming(fillEmptyOnly: boolean): void {
  const urls = incomingImages.value.map((item) => item.url)
  if (!urls.length) return
  const next = fillComicPageFromImageUrls(page.value, urls, {
    fillEmptyOnly,
    createMissingPanels: true
  })
  commit(next)
}

function onPageTitle(value: string): void {
  commit(withComicPageLayout(page.value, { title: value }))
}

function onBackgroundColor(value: string, persistNow: boolean): void {
  commit(withComicPageLayout(page.value, { backgroundColor: value }), { persist: persistNow })
}

function onPageBorderColor(value: string, persistNow: boolean): void {
  commit(withComicPageLayout(page.value, { borderColor: value }), { persist: persistNow })
}

function onPanelBackgroundColor(value: string, persistNow: boolean): void {
  patchSelectedPanel({ backgroundColor: value }, { persist: persistNow })
}

function onPanelBorderWidth(event: Event): void {
  const raw = (event.target as HTMLInputElement).value.trim()
  if (!raw) {
    patchSelectedPanel({ borderWidth: undefined })
    return
  }
  const n = Number(raw)
  if (Number.isFinite(n)) patchSelectedPanel({ borderWidth: n })
}

function onPanelDurationSec(event: Event): void {
  const raw = (event.target as HTMLInputElement).value.trim()
  if (!raw) {
    patchSelectedPanel({ durationSec: undefined })
    return
  }
  const n = Number(raw)
  if (Number.isFinite(n) && n >= 0.5) patchSelectedPanel({ durationSec: n })
}

async function resolvePanelImageDataUrl(rawUrl: string): Promise<string> {
  const url = rawUrl.trim()
  if (!url) return ''
  if (url.startsWith('data:') || url.startsWith('http://') || url.startsWith('https://')) {
    return url
  }
  try {
    return (await window.studio.getAssetMediaDataUrl(url)) || ''
  } catch {
    return ''
  }
}

async function onGeneratePanelMicroVideo(): Promise<void> {
  const panel = selectedPanel.value
  if (!panel?.imageUrl || generatingPanelVideo.value) return
  generatingPanelVideo.value = true
  try {
    const firstFrameDataUrl = await resolvePanelImageDataUrl(panel.imageUrl)
    if (!firstFrameDataUrl) return
    const dialogueSummary = panel.bubbles
      .map((b) => (b.speaker ? `${b.speaker}: ${b.text}` : b.text))
      .join(' ')
      .slice(0, 120)
    const prompt = [
      'Bilibili Motion Comic 2.5D micro-animation shot: strictly preserve original manga/comic art style, linework, character identity and framing.',
      'Subtle natural blinking, breathing, hair and clothing gently swaying in the breeze, expressive lip movement and atmospheric lighting flow, steady camera.',
      panel.title || panel.caption || '',
      dialogueSummary
    ]
      .filter(Boolean)
      .join(' ')
    const res = await window.studio.generateVideo({
      prompt,
      firstFrameImageUrl: firstFrameDataUrl,
      duration: Math.min(5, Math.max(3, Math.round(panel.durationSec ?? 4))),
      name: `comic_panel_i2v_${panel.id}`
    })
    if (res?.relativePath?.trim()) {
      patchSelectedPanel({ videoUrl: res.relativePath.trim() })
    }
  } catch {
    // ignore video generation failure when model is unconfigured
  } finally {
    generatingPanelVideo.value = false
  }
}

async function onExtractPanelForeground(): Promise<void> {
  const panel = selectedPanel.value
  const currentNode = node.value
  if (!panel?.imageUrl || !currentNode || extractingPanelForeground.value) return
  extractingPanelForeground.value = true
  try {
    const srcDataUrl = await resolvePanelImageDataUrl(panel.imageUrl)
    if (!srcDataUrl) return
    const genRes = await window.studio.generateImage({
      prompt:
        'Extract the main foreground character/subject on a pure solid white background (#FFFFFF) for transparent cutout, strictly preserving the exact pose, comic linework, colors, and proportions from @1.',
      inputReferences: [srcDataUrl],
      transparentBackground: true
    })
    const rawImgUrl = genRes?.images?.[0]?.trim() || ''
    if (!rawImgUrl || !project.isOpen) return
    let transparentDataUrl = rawImgUrl
    try {
      const keyed = await removeImageSolidBackground({ dataUrl: rawImgUrl })
      if (keyed?.dataUrl) transparentDataUrl = keyed.dataUrl
    } catch {
      // keep rawImgUrl if background keying fails
    }
    const fgRel =
      (await saveGraphRunMediaForNode({
        dataUrl: transparentDataUrl,
        key: `comicFg:${activeNodeId.value}:${panel.id}`,
        node: currentNode,
        hostAssetId: hostAssetId.value || null,
        kind: 'image'
      })) || ''
    if (fgRel) {
      patchSelectedPanel({
        foregroundImageUrl: fgRel,
        parallaxDepth: panel.parallaxDepth ?? 0.55
      })
    }
  } catch {
    // ignore foreground extraction failure when model is unconfigured
  } finally {
    extractingPanelForeground.value = false
  }
}

async function onGenerateMotionComic(): Promise<void> {
  if (generatingMotionComic.value || page.value.panels.length === 0) return
  generatingMotionComic.value = true
  try {
    dirty.value = true
    persist()
    const currentNode = node.value
    let pageRel =
      currentNode?.params.previewRelativePath?.trim() ||
      currentNode?.params.generatedImages?.[0]?.relativePath?.trim() ||
      ''
    const panelImageRelativePaths: Record<string, string> = {}
    const bubbleImageRelativePaths: Record<string, string> = {}
    const bundle = await canvasRef.value?.renderMotionComicBundle?.()
    const pngDataUrl = bundle?.dataUrl || (await canvasRef.value?.renderPngDataUrl?.()) || ''
    if (pngDataUrl && currentNode && project.isOpen) {
      try {
        const createdAt = new Date().toISOString()
        const bubbleEntries = Object.entries(bundle?.bubbleDataUrls ?? {})
        const savedBubbleItems: Array<{
          id: string
          title: string
          dataUrl: string
          relativePath: string
          createdAt: string
        }> = []
        for (const [bubbleId, bubbleDataUrl] of bubbleEntries) {
          if (!bubbleDataUrl) continue
          const savedBubbleRel = await saveGraphRunMediaForNode({
            dataUrl: bubbleDataUrl,
            key: `comicBubble:${activeNodeId.value}:${bubbleId}`,
            node: currentNode,
            hostAssetId: hostAssetId.value || null,
            kind: 'image'
          })
          if (savedBubbleRel) {
            bubbleImageRelativePaths[bubbleId] = savedBubbleRel
            savedBubbleItems.push({
              id: `comic-bubble:${activeNodeId.value}:${bubbleId}`,
              title: `${page.value.title?.trim() || currentNode.title || 'Comic Page'} · ${bubbleId}`,
              dataUrl: bubbleDataUrl,
              relativePath: savedBubbleRel,
              createdAt
            })
          }
        }
        const panelEntries = Object.entries(bundle?.panelDataUrls ?? {})
        const savedPanelItems: Array<{
          id: string
          title: string
          dataUrl: string
          relativePath: string
          createdAt: string
        }> = []
        for (const [panelId, panelDataUrl] of panelEntries) {
          if (!panelDataUrl) continue
          const savedPanelRel = await saveGraphRunMediaForNode({
            dataUrl: panelDataUrl,
            key: `comicPanel:${activeNodeId.value}:${panelId}`,
            node: currentNode,
            hostAssetId: hostAssetId.value || null,
            kind: 'image'
          })
          if (savedPanelRel) {
            panelImageRelativePaths[panelId] = savedPanelRel
            savedPanelItems.push({
              id: `comic-panel:${activeNodeId.value}:${panelId}`,
              title: `${page.value.title?.trim() || currentNode.title || 'Comic Page'} · ${panelId}`,
              dataUrl: panelDataUrl,
              relativePath: savedPanelRel,
              createdAt
            })
          }
        }
        const savedRel = await saveGraphRunMediaForNode({
          dataUrl: pngDataUrl,
          key: `comicPage:${activeNodeId.value}`,
          node: currentNode,
          hostAssetId: hostAssetId.value || null,
          kind: 'image'
        })
        if (savedRel) {
          pageRel = savedRel
          const imgId = `comic-page:${activeNodeId.value}`
          graphEditorHosts.updateNode(props.hostId, activeNodeId.value, {
            comicPage: serializeComicPage(page.value),
            previewRelativePath: savedRel,
            generatedImages: [
              ...savedBubbleItems,
              ...savedPanelItems,
              {
                id: imgId,
                title: page.value.title?.trim() || currentNode.title || 'Comic Page',
                dataUrl: pngDataUrl,
                relativePath: savedRel,
                createdAt
              }
            ],
            selectedImageId: imgId
          })
        }
      } catch {
        // ignore media save failure and fall back to panel imageUrls
      }
    }

    const doc = graphEditorHosts.getDocument(props.hostId)
    const allComicNodeIds = doc
      ? doc.nodes.filter((n) => n.typeId === 'comic.page').map((n) => n.id)
      : [activeNodeId.value]
    let timelineNodeId = ''
    if (doc) {
      const connectedTl = doc.nodes.find(
        (n) =>
          n.typeId === 'output.timeline' &&
          doc.edges.some((e) => e.source === activeNodeId.value && e.target === n.id)
      )
      const anyTl = connectedTl ?? doc.nodes.find((n) => n.typeId === 'output.timeline')
      if (anyTl) {
        timelineNodeId = anyTl.id
        const missingSourceIds = allComicNodeIds.filter(
          (cid) => !doc.edges.some((e) => e.source === cid && e.target === timelineNodeId)
        )
        if (missingSourceIds.length > 0) {
          graphEditorHosts.applyExternalGraph(props.hostId, {
            ...doc,
            edges: [
              ...doc.edges,
              ...missingSourceIds.map((cid, idx) => ({
                id: `edge-comic-${Date.now().toString(36)}-${idx}`,
                source: cid,
                target: timelineNodeId,
                sourcePort: 'out',
                targetPort: 'in-image'
              }))
            ]
          })
        }
      }
    }
    if (!timelineNodeId) {
      const addedId = graphEditorHosts.addNode(props.hostId, {
        typeId: 'output.timeline',
        title: pickComicBi('动态漫时间线', 'Motion Comic Timeline'),
        linkFrom: allComicNodeIds.map((cid) => ({ nodeId: cid, portId: 'out' }))
      })
      timelineNodeId = addedId ?? 'output-timeline'
    }

    await graphEditorHosts.flush(props.hostId)

    const latestDoc = graphEditorHosts.getDocument(props.hostId) ?? doc
    const sortedComicNodes = latestDoc
      ? latestDoc.nodes
          .filter((n) => n.typeId === 'comic.page')
          .sort((a, b) => {
            const dy = (a.position?.y ?? 0) - (b.position?.y ?? 0)
            if (Math.abs(dy) > 40) return dy
            const dx = (a.position?.x ?? 0) - (b.position?.x ?? 0)
            if (Math.abs(dx) > 10) return dx
            return a.id.localeCompare(b.id)
          })
      : []

    const discoveredVoices: Array<{
      id: string
      relativePath: string
      durationSec?: number
      text?: string
      title?: string
    }> = []
    let discoveredMusic: { id: string; relativePath: string; title?: string } | null = null
    if (latestDoc) {
      for (const n of latestDoc.nodes) {
        if (n.typeId === 'asset.music' && !discoveredMusic) {
          const mRel =
            n.params?.generatedVoices?.[0]?.relativePath?.trim() ||
            n.params?.previewRelativePath?.trim()
          if (mRel) {
            discoveredMusic = {
              id: n.params?.generatedVoices?.[0]?.id || n.id,
              relativePath: mRel,
              title: n.title?.trim() || 'BGM'
            }
          }
        } else if (n.typeId === 'voice.tts' || n.typeId === 'asset.voice') {
          const vRel =
            n.params?.generatedVoices?.[0]?.relativePath?.trim() ||
            n.params?.previewRelativePath?.trim()
          if (vRel) {
            discoveredVoices.push({
              id: n.params?.generatedVoices?.[0]?.id || n.id,
              relativePath: vRel,
              text:
                n.params?.notes?.trim() ||
                n.params?.generateInstruction?.trim() ||
                n.params?.text?.trim(),
              title: n.title?.trim()
            })
          }
        }
      }
    }

    // 若图中尚无独立配音节点，自动为所有分镜页中的气泡台词批量合成 AI 角色语音（并复用已有缓存）
    if (
      discoveredVoices.length === 0 &&
      typeof window !== 'undefined' &&
      typeof window.studio?.generateSpeech === 'function'
    ) {
      const targetNodes =
        sortedComicNodes.length > 0 ? sortedComicNodes : currentNode ? [currentNode] : []
      const allDialogues: Array<{
        nodeId: string
        panelIndex: number
        bubbleId: string
        speaker?: string
        text: string
        shape: string
      }> = []
      for (const cn of targetNodes) {
        const cnPage =
          cn.id === activeNodeId.value
            ? page.value
            : (parseComicPage(cn.params?.comicPage) ?? createComicPage())
        for (const d of extractComicDialogueLines(cnPage)) {
          if (d.text.trim()) {
            allDialogues.push({
              nodeId: cn.id,
              panelIndex: d.panelIndex,
              bubbleId: d.bubbleId,
              speaker: d.speaker,
              text: d.text.trim(),
              shape: d.shape
            })
          }
        }
      }

      if (allDialogues.length > 0) {
        const tlNode = latestDoc?.nodes.find((n) => n.id === timelineNodeId)
        const cachedVoices = new Map<string, { relativePath: string }>()
        for (const item of tlNode?.params?.generatedVoices ?? []) {
          if (item.id && item.relativePath?.trim()) {
            cachedVoices.set(item.id, {
              relativePath: item.relativePath.trim()
            })
          }
        }

        const voicePalette = ['onyx', 'nova', 'alloy', 'shimmer', 'echo', 'fable']
        const speakerVoiceMap = new Map<string, string>()
        const pickSpeakerVoice = (speaker?: string, shape?: string): string => {
          const key = (speaker ?? '').trim()
          if (!key) {
            if (shape === 'narration' || shape === 'thought') return 'echo'
            return 'alloy'
          }
          const existing = speakerVoiceMap.get(key)
          if (existing) return existing
          const assigned = voicePalette[speakerVoiceMap.size % voicePalette.length]!
          speakerVoiceMap.set(key, assigned)
          return assigned
        }

        const synthesizedItems: Array<{
          id: string
          title: string
          relativePath: string
          createdAt: string
        }> = []
        const createdAt = new Date().toISOString()
        const concurrency = 3
        for (let i = 0; i < allDialogues.length; i += concurrency) {
          const chunk = allDialogues.slice(i, i + concurrency)
          const results = await Promise.all(
            chunk.map(async (line) => {
              const voiceId = `comic-tts-${line.nodeId}-${line.bubbleId}`
              const title = line.speaker ? `${line.speaker}: ${line.text}` : line.text
              const cached = cachedVoices.get(voiceId)
              if (cached) {
                return {
                  id: voiceId,
                  relativePath: cached.relativePath,
                  text: line.text,
                  title
                }
              }
              try {
                const voice = pickSpeakerVoice(line.speaker, line.shape)
                const res = await window.studio.generateSpeech({
                  input: line.text,
                  voice,
                  name: `comic-tts-${line.nodeId}-p${line.panelIndex + 1}`
                })
                const rel = res?.relativePath?.trim()
                if (!rel) return null
                return {
                  id: voiceId,
                  relativePath: rel,
                  text: line.text,
                  title
                }
              } catch {
                return null
              }
            })
          )
          for (const item of results) {
            if (!item) continue
            discoveredVoices.push(item)
            synthesizedItems.push({
              id: item.id,
              title: item.title || item.id,
              relativePath: item.relativePath,
              createdAt
            })
          }
        }

        if (synthesizedItems.length > 0 && timelineNodeId) {
          graphEditorHosts.updateNode(props.hostId, timelineNodeId, {
            generatedVoices: synthesizedItems,
            selectedVoiceId: synthesizedItems[0]!.id
          })
        }
      }
    }

    // 并发探测所有角色配音的真实音频秒数（durationSec），确保运镜时长、气泡弹跳与卡拉 OK 字幕毫秒级对齐
    if (discoveredVoices.length > 0) {
      await Promise.all(
        discoveredVoices.map(async (v) => {
          if (v.durationSec && v.durationSec > 0.15) return
          const probed = await probeAudioDurationSec(v.relativePath)
          if (probed && probed > 0.15) {
            v.durationSec = probed
          }
        })
      )
    }

    // 编译单页或多页全集动态漫时间线（支持跨页 0.32s 翻页转场与全片 BGM 铺底）
    const targetComicNodes =
      sortedComicNodes.length > 0 ? sortedComicNodes : currentNode ? [currentNode] : []
    let motionDoc: ScriptTimelineDocument
    if (targetComicNodes.length <= 1) {
      motionDoc = buildComicMotionTimeline({
        page: page.value,
        pageImageRelativePath: pageRel || undefined,
        panelImageRelativePaths:
          Object.keys(panelImageRelativePaths).length > 0 ? panelImageRelativePaths : undefined,
        bubbleImageRelativePaths:
          Object.keys(bubbleImageRelativePaths).length > 0 ? bubbleImageRelativePaths : undefined,
        nodeId: activeNodeId.value,
        nodeTitle: currentNode?.title,
        ...(discoveredVoices.length > 0 ? { voices: discoveredVoices } : {}),
        ...(discoveredMusic ? { music: [discoveredMusic] } : {})
      })
    } else {
      const mergedSources: ScriptTimelineSource[] = []
      const seenSourceIds = new Set<string>()
      const mergedClips: ScriptTimelineClip[] = []
      let mergedSettings: ScriptTimelineSettings = {
        durationSec: 6,
        exportWidth: 1280,
        exportHeight: 720,
        exportFps: 24
      }
      let pageCursor = 0
      let voiceOffset = 0
      const crossPageTransSec = 0.32

      for (let pageIdx = 0; pageIdx < targetComicNodes.length; pageIdx++) {
        const cn = targetComicNodes[pageIdx]!
        const isCurrent = cn.id === activeNodeId.value
        const cnPage = isCurrent
          ? page.value
          : (parseComicPage(cn.params?.comicPage) ?? createComicPage())
        if (cnPage.panels.length === 0) continue

        let cnPageRel = ''
        const cnPanelPaths: Record<string, string> = {}
        const cnBubblePaths: Record<string, string> = {}
        if (isCurrent) {
          cnPageRel = pageRel
          Object.assign(cnPanelPaths, panelImageRelativePaths)
          Object.assign(cnBubblePaths, bubbleImageRelativePaths)
        } else {
          const genList = cn.params?.generatedImages ?? []
          const panelPrefix = `comic-panel:${cn.id}:`
          const bubblePrefix = `comic-bubble:${cn.id}:`
          const pageItemId = `comic-page:${cn.id}`
          for (const item of genList) {
            const rel = item.relativePath?.trim()
            const itemId = item.id ?? ''
            if (!rel || !itemId) continue
            if (itemId.startsWith(panelPrefix)) {
              const pid = itemId.slice(panelPrefix.length)
              if (pid) cnPanelPaths[pid] = rel
            } else if (itemId.startsWith(bubblePrefix)) {
              const bid = itemId.slice(bubblePrefix.length)
              if (bid) cnBubblePaths[bid] = rel
            } else if (itemId === pageItemId && !cnPageRel) {
              cnPageRel = rel
            }
          }
          if (!cnPageRel) {
            cnPageRel =
              cn.params?.previewRelativePath?.trim() ||
              genList
                .find(
                  (i) =>
                    !(i.id ?? '').startsWith(panelPrefix) && !(i.id ?? '').startsWith(bubblePrefix)
                )
                ?.relativePath?.trim() ||
              ''
          }
        }

        const dlgCount = extractComicDialogueLines(cnPage).length
        const pageVoiceCount = dlgCount > 0 ? dlgCount : cnPage.panels.length
        const pageVoices = discoveredVoices.slice(voiceOffset, voiceOffset + pageVoiceCount)
        voiceOffset += pageVoices.length

        const built = buildComicMotionTimeline({
          page: cnPage,
          pageImageRelativePath: cnPageRel || undefined,
          panelImageRelativePaths: Object.keys(cnPanelPaths).length > 0 ? cnPanelPaths : undefined,
          bubbleImageRelativePaths:
            Object.keys(cnBubblePaths).length > 0 ? cnBubblePaths : undefined,
          nodeId: cn.id,
          nodeTitle: cn.title,
          ...(pageVoices.length > 0 ? { voices: pageVoices } : {}),
          ...(pageIdx === 0 && discoveredMusic ? { music: [discoveredMusic] } : {})
        })

        if (pageIdx === 0 && built.settings) {
          mergedSettings = { ...built.settings }
        }
        for (const src of built.sources ?? []) {
          if (!seenSourceIds.has(src.id)) {
            seenSourceIds.add(src.id)
            mergedSources.push(src)
          }
        }

        if (pageIdx > 0 && mergedClips.length > 0) {
          for (let ci = mergedClips.length - 1; ci >= 0; ci--) {
            if (mergedClips[ci]!.track === 'video') {
              mergedClips[ci] = {
                ...mergedClips[ci]!,
                durationSec:
                  Math.round((mergedClips[ci]!.durationSec + crossPageTransSec) * 1000) / 1000
              }
              break
            }
          }
        }

        let firstVideoClipSeen = false
        for (const clip of built.clips) {
          const isFirstVideoOfNextPage =
            pageIdx > 0 && clip.track === 'video' && !firstVideoClipSeen
          if (clip.track === 'video') firstVideoClipSeen = true
          mergedClips.push({
            ...clip,
            id: `${clip.id}:p${pageIdx}`,
            startSec: Math.round((clip.startSec + pageCursor) * 1000) / 1000,
            ...(isFirstVideoOfNextPage
              ? {
                  transitionType: 'smoothleft' as const,
                  transitionInSec: crossPageTransSec
                }
              : {})
          })
        }

        const pageDur = contentEndSecOfTimeline(built.clips)
        pageCursor = Math.round((pageCursor + pageDur) * 1000) / 1000
      }

      // 将首轨 BGM 延展至覆盖多页完整总时长
      const finalDur = Math.max(3, pageCursor)
      mergedSettings.durationSec = finalDur
      if (discoveredMusic && pageCursor > 0) {
        for (let ci = 0; ci < mergedClips.length; ci++) {
          if (mergedClips[ci]!.track === 'music') {
            mergedClips[ci] = {
              ...mergedClips[ci]!,
              durationSec: Math.max(mergedClips[ci]!.durationSec, finalDur)
            }
          }
        }
      }

      motionDoc = {
        clips: mergedClips,
        sources: mergedSources,
        settings: mergedSettings
      }
    }

    const aid = hostAssetId.value
    if (aid) {
      const baseGen = isDraftAssetId(aid)
        ? { ...(drafts.getDraft(aid)?.genParams ?? {}) }
        : {
            ...((project.assets.find((a) => a.id === aid)?.genParams as
              Record<string, unknown> | undefined) ?? {})
          }
      const nextGen = withScriptTimeline(baseGen, motionDoc, timelineNodeId)
      if (isDraftAssetId(aid)) {
        drafts.updateDraft(aid, { genParams: nextGen })
      } else {
        await persistAssetRecord(aid, { genParams: nextGen })
      }
      await editorDive?.diveView(
        { viewId: 'script.timeline', scriptAssetId: aid, timelineNodeId },
        pickComicBi('动态漫时间线', 'Motion Comic Timeline')
      )
    }
  } finally {
    generatingMotionComic.value = false
  }
}

function onMetaNumber(
  key:
    'columns' | 'rows' | 'gutter' | 'width' | 'height' | 'padding' | 'borderWidth' | 'borderRadius',
  event: Event
): void {
  const n = Number((event.target as HTMLInputElement).value)
  if (!Number.isFinite(n)) return
  commit(withComicPageLayout(page.value, { [key]: n }))
}

function addEmptyPanel(): void {
  const empty = findEmptyComicCell(page.value)
  if (empty) {
    addPanelAtEmpty(empty.row, empty.col)
    return
  }
  // 网格已满时，在 (0,0) 添加一个画中画浮动叠格
  const next = addComicPanel(page.value, { row: 0, col: 0, zIndex: 2 })
  const added = next.panels[next.panels.length - 1]
  commit(next)
  selectedPanelId.value = added?.id ?? null
  selectedBubbleId.value = null
}

function showGlobalProps(): void {
  selectedPanelId.value = null
  selectedBubbleId.value = null
}

function addPanelAtEmpty(row: number, col: number, imageUrl?: string): void {
  const occupied = comicOccupiedCellKeys(page.value)
  if (occupied.has(`${row},${col}`)) return
  const next = addComicPanel(page.value, { row, col, ...(imageUrl ? { imageUrl } : {}) })
  const added = next.panels.find((panel) => !page.value.panels.some((prev) => prev.id === panel.id))
  commit(next)
  selectedPanelId.value = added?.id ?? selectedPanelId.value
  selectedBubbleId.value = null
}

function onDropImage(hit: ComicPageCanvasHit, imageUrl: string, extraUrls?: string[]): void {
  if (extraUrls && extraUrls.length > 0) {
    commit(
      fillComicPageFromImageUrls(page.value, [imageUrl, ...extraUrls], {
        fillEmptyOnly: true,
        createMissingPanels: true
      })
    )
    return
  }
  if (hit.kind === 'panel') {
    const panel = page.value.panels.find((item) => item.id === hit.panelId)
    if (!panel) return
    selectedPanelId.value = hit.panelId
    selectedBubbleId.value = null
    commit(upsertComicPanel(page.value, { ...panel, imageUrl }))
    return
  }
  if (hit.kind === 'cell') {
    addPanelAtEmpty(hit.row, hit.col, imageUrl)
    return
  }
  if (selectedPanel.value) {
    patchSelectedPanel({ imageUrl })
    return
  }
  const emptyPanel = page.value.panels.find((p) => !p.imageUrl)
  if (emptyPanel) {
    selectedPanelId.value = emptyPanel.id
    commit(upsertComicPanel(page.value, { ...emptyPanel, imageUrl }))
  }
}

function onRemoveImage(panelId: string): void {
  const panel = page.value.panels.find((item) => item.id === panelId)
  if (!panel) return
  commit(upsertComicPanel(page.value, { ...panel, imageUrl: '' }))
}

function removeSelectedPanel(): void {
  if (!selectedPanelId.value) return
  commit(removeComicPanel(page.value, selectedPanelId.value))
  selectedPanelId.value = null
  selectedBubbleId.value = null
}

function onDeletePanelById(panelId: string): void {
  commit(removeComicPanel(page.value, panelId))
  if (selectedPanelId.value === panelId) {
    selectedPanelId.value = null
    selectedBubbleId.value = null
  }
}

function addBubbleToPanel(panelId: string, shape: ComicBubbleShape = 'oval'): void {
  selectedPanelId.value = panelId
  const isSfx = shape === 'sfx'
  const next = addComicBubble(page.value, panelId, {
    text: isSfx
      ? pickComicBi('轰！！', 'BOOM!!')
      : t('graph.inspector.comicPage.bubblePlaceholder'),
    x: isSfx ? 0.68 : 0.5,
    y: isSfx ? 0.72 : 0.25,
    tail: 'bl',
    shape,
    ...(isSfx
      ? {
          textColor: '#e11d48',
          backgroundColor: '#ffffff',
          borderColor: '#111111',
          fontWeight: 'black' as const,
          rotation: -10,
          scale: 1.3
        }
      : {})
  })
  const panel = next.panels.find((item) => item.id === panelId)
  const last = panel?.bubbles[panel.bubbles.length - 1]
  commit(next)
  selectedBubbleId.value = last?.id ?? null
}

function addBubbleToSelected(shape: ComicBubbleShape = 'oval'): void {
  const targetPanelId = selectedPanelId.value || page.value.panels[0]?.id
  if (!targetPanelId) return
  addBubbleToPanel(targetPanelId, shape)
}

function insertBubblePreset(bp: BubblePresetItem): void {
  const targetPanelId = selectedPanelId.value || page.value.panels[0]?.id
  if (!targetPanelId) {
    addEmptyPanel()
  }
  const panelId = selectedPanelId.value || page.value.panels[0]?.id
  if (!panelId) return
  const isDark = bp.id === 'dark-shout'
  const next = addComicBubble(page.value, panelId, {
    text: bp.text,
    x: 0.5,
    y: 0.28,
    tail: 'bl',
    shape: bp.shape,
    writingMode: bp.writingMode,
    scale: bp.scale ?? 1,
    ...(isDark
      ? {
          backgroundColor: '#111111',
          borderColor: '#ffffff',
          textColor: '#ffffff',
          fontWeight: 'black' as const
        }
      : {})
  })
  const panel = next.panels.find((item) => item.id === panelId)
  const last = panel?.bubbles[panel.bubbles.length - 1]
  commit(next)
  selectedPanelId.value = panelId
  selectedBubbleId.value = last?.id ?? null
}

function insertSfxPreset(sfx: SfxPresetItem): void {
  const targetPanelId = selectedPanelId.value || page.value.panels[0]?.id
  if (!targetPanelId) {
    addEmptyPanel()
  }
  const panelId = selectedPanelId.value || page.value.panels[0]?.id
  if (!panelId) return
  const next = addComicBubble(page.value, panelId, {
    text: sfx.text,
    x: 0.65,
    y: 0.7,
    tail: 'bl',
    shape: 'sfx',
    writingMode: sfx.writingMode ?? 'horizontal-tb',
    textColor: sfx.color,
    backgroundColor: '#ffffff',
    borderColor: '#111111',
    fontWeight: 'black',
    rotation: sfx.rotation,
    scale: 1.35
  })
  const panel = next.panels.find((item) => item.id === panelId)
  const last = panel?.bubbles[panel.bubbles.length - 1]
  commit(next)
  selectedPanelId.value = panelId
  selectedBubbleId.value = last?.id ?? null
}

function removeSelectedBubble(): void {
  if (!selectedPanelId.value || !selectedBubbleId.value) return
  commit(removeComicBubble(page.value, selectedPanelId.value, selectedBubbleId.value))
  selectedBubbleId.value = null
}

function onDeleteBubbleById(panelId: string, bubbleId: string): void {
  commit(removeComicBubble(page.value, panelId, bubbleId))
  if (selectedBubbleId.value === bubbleId) selectedBubbleId.value = null
}

function onDuplicateBubble(panelId: string, bubbleId: string): void {
  const res = duplicateComicBubble(page.value, panelId, bubbleId)
  commit(res.page)
  if (res.newBubbleId) {
    selectedPanelId.value = panelId
    selectedBubbleId.value = res.newBubbleId
  }
}

function onSwapPanels(panelIdA: string, panelIdB: string): void {
  commit(swapComicPanelContents(page.value, panelIdA, panelIdB))
}

function onMovePanel(panelId: string, row: number, col: number): void {
  selectedPanelId.value = panelId
  selectedBubbleId.value = null
  commit(moveComicPanel(page.value, panelId, row, col))
}

function onTransferBubble(
  fromPanelId: string,
  bubbleId: string,
  toPanelId: string,
  pos: { x: number; y: number }
): void {
  const fromPanel = page.value.panels.find((p) => p.id === fromPanelId)
  const bubble = fromPanel?.bubbles.find((b) => b.id === bubbleId)
  if (!bubble) return
  const withoutOld = removeComicBubble(page.value, fromPanelId, bubbleId)
  const pointingUp = pos.y > 0.58
  const onLeft = pos.x >= 0.5
  const autoTail: ComicBubbleTail = pointingUp ? (onLeft ? 'tl' : 'tr') : onLeft ? 'bl' : 'br'
  const withNew = addComicBubble(withoutOld, toPanelId, {
    ...bubble,
    x: pos.x,
    y: pos.y,
    tail: autoTail,
    tailTipX: undefined,
    tailTipY: undefined
  })
  const targetPanel = withNew.panels.find((p) => p.id === toPanelId)
  const added = targetPanel?.bubbles[targetPanel.bubbles.length - 1]
  commit(withNew)
  selectedPanelId.value = toPanelId
  selectedBubbleId.value = added?.id ?? null
}

function deleteCurrentSelection(): void {
  if (selectedBubbleId.value) {
    removeSelectedBubble()
  } else if (selectedPanelId.value) {
    removeSelectedPanel()
  }
}

/**
 * 相邻分镜平行斜切刀口耦合：无论是点击斜切预设还是手动拖拽四角斜切控制柄，
 * 自动同步共享上/下/左/右边界的相邻分格顶点像素偏移，确保格间形成等宽平行斜缝而非三角楔形缺口。
 */
function couplePanelCornerOffsets(
  basePage: ComicPage,
  panelId: string,
  offsets: ComicCornerOffsets | undefined
): ComicPage {
  const panel = basePage.panels.find((p) => p.id === panelId)
  if (!panel) return basePage
  const o: ComicCornerOffsets = offsets ?? [0, 0, 0, 0, 0, 0, 0, 0]
  const rects = comicPanelRects(basePage)
  const rect = rects.get(panel.id)
  if (!rect) {
    return upsertComicPanel(basePage, { ...panel, cornerOffsets: offsets })
  }

  const nextPanels = basePage.panels.map((other) => {
    if (other.id === panel.id) {
      return { ...other, cornerOffsets: offsets }
    }
    const otherRect = rects.get(other.id)
    if (!otherRect) return other

    const curO: ComicCornerOffsets = other.cornerOffsets
      ? ([...other.cornerOffsets] as ComicCornerOffsets)
      : [0, 0, 0, 0, 0, 0, 0, 0]
    let touched = false

    const overlapCols =
      Math.min(panel.col + panel.colSpan, other.col + other.colSpan) -
      Math.max(panel.col, other.col)
    const overlapRows =
      Math.min(panel.row + panel.rowSpan, other.row + other.rowSpan) -
      Math.max(panel.row, other.row)

    // 1. other 紧邻当前分格下方（共享底边 ↔ 顶边）
    if (other.row === panel.row + panel.rowSpan && overlapCols > 0) {
      const dyLeftPx = o[7] * rect.height
      const dyRightPx = o[5] * rect.height
      const tLeft = (otherRect.x - rect.x) / Math.max(1, rect.width)
      const tRight = (otherRect.x + otherRect.width - rect.x) / Math.max(1, rect.width)
      curO[1] = (dyLeftPx + (dyRightPx - dyLeftPx) * tLeft) / Math.max(1, otherRect.height)
      curO[3] = (dyLeftPx + (dyRightPx - dyLeftPx) * tRight) / Math.max(1, otherRect.height)
      touched = true
    }

    // 2. other 紧邻当前分格上方（共享顶边 ↔ 底边）
    if (other.row + other.rowSpan === panel.row && overlapCols > 0) {
      const dyLeftPx = o[1] * rect.height
      const dyRightPx = o[3] * rect.height
      const tLeft = (otherRect.x - rect.x) / Math.max(1, rect.width)
      const tRight = (otherRect.x + otherRect.width - rect.x) / Math.max(1, rect.width)
      curO[7] = (dyLeftPx + (dyRightPx - dyLeftPx) * tLeft) / Math.max(1, otherRect.height)
      curO[5] = (dyLeftPx + (dyRightPx - dyLeftPx) * tRight) / Math.max(1, otherRect.height)
      touched = true
    }

    // 3. other 紧邻当前分格右侧（共享右边 ↔ 左边）
    if (other.col === panel.col + panel.colSpan && overlapRows > 0) {
      const dxTopPx = o[2] * rect.width
      const dxBottomPx = o[4] * rect.width
      const tTop = (otherRect.y - rect.y) / Math.max(1, rect.height)
      const tBottom = (otherRect.y + otherRect.height - rect.y) / Math.max(1, rect.height)
      curO[0] = (dxTopPx + (dxBottomPx - dxTopPx) * tTop) / Math.max(1, otherRect.width)
      curO[6] = (dxTopPx + (dxBottomPx - dxTopPx) * tBottom) / Math.max(1, otherRect.width)
      touched = true
    }

    // 4. other 紧邻当前分格左侧（共享左边 ↔ 右边）
    if (other.col + other.colSpan === panel.col && overlapRows > 0) {
      const dxTopPx = o[0] * rect.width
      const dxBottomPx = o[6] * rect.width
      const tTop = (otherRect.y - rect.y) / Math.max(1, rect.height)
      const tBottom = (otherRect.y + otherRect.height - rect.y) / Math.max(1, rect.height)
      curO[2] = (dxTopPx + (dxBottomPx - dxTopPx) * tTop) / Math.max(1, otherRect.width)
      curO[4] = (dxTopPx + (dxBottomPx - dxTopPx) * tBottom) / Math.max(1, otherRect.width)
      touched = true
    }

    if (!touched) return other
    const hasAnyOffset = curO.some((v) => Math.abs(v) >= 0.001)
    return {
      ...other,
      cornerOffsets: hasAnyOffset ? curO : undefined
    }
  })

  return normalizeComicPage({ ...basePage, panels: nextPanels })
}

function patchSelectedPanel(patch: Partial<ComicPanel>, options?: { persist?: boolean }): void {
  const current = selectedPanel.value
  if (!current) return
  commit(upsertComicPanel(page.value, { ...current, ...patch }), options)
}

function onCanvasUpdatePanel(panelId: string, patch: Partial<ComicPanel>, persistNow = true): void {
  const panel = page.value.panels.find((p) => p.id === panelId)
  if (!panel) return
  if ('cornerOffsets' in patch) {
    commit(couplePanelCornerOffsets(page.value, panelId, patch.cornerOffsets), {
      persist: persistNow
    })
    return
  }
  commit(upsertComicPanel(page.value, { ...panel, ...patch }), { persist: persistNow })
}

function onCanvasUpdateBubble(
  panelId: string,
  bubbleId: string,
  patch: Partial<ComicSpeechBubble>,
  persistNow = true
): void {
  commit(updateComicBubble(page.value, panelId, bubbleId, patch), { persist: persistNow })
}

function applySlantPreset(preset: ComicPanelSlantPreset): void {
  const panel = selectedPanel.value
  if (!panel) return
  const offsets = slantPresetToCornerOffsets(preset)
  commit(couplePanelCornerOffsets(page.value, panel.id, offsets))
}

function onPanelGridPos(key: 'row' | 'col', event: Event): void {
  if (!selectedPanel.value) return
  const n = Number((event.target as HTMLInputElement).value)
  if (!Number.isFinite(n)) return
  const row = key === 'row' ? n : selectedPanel.value.row
  const col = key === 'col' ? n : selectedPanel.value.col
  commit(moveComicPanel(page.value, selectedPanel.value.id, row, col))
}

function onSpan(key: 'colSpan' | 'rowSpan', event: Event): void {
  const n = Number((event.target as HTMLInputElement).value)
  if (!Number.isFinite(n)) return
  patchSelectedPanel({ [key]: n })
}

function patchSelectedBubble(patch: Partial<ComicSpeechBubble>, persistNow = true): void {
  if (!selectedPanelId.value || !selectedBubbleId.value) return
  commit(updateComicBubble(page.value, selectedPanelId.value, selectedBubbleId.value, patch), {
    persist: persistNow
  })
}

function onMoveBubble(panelId: string, bubbleId: string, pos: { x: number; y: number }): void {
  selectedPanelId.value = panelId
  selectedBubbleId.value = bubbleId
  const panel = page.value.panels.find((p) => p.id === panelId)
  const bubble = panel?.bubbles.find((b) => b.id === bubbleId)
  const patch: Partial<ComicSpeechBubble> = { x: pos.x, y: pos.y }
  // 当未手动锁定尾巴尖端时，根据气泡在分格内的象限自动翻转尾巴朝向，使其始终朝向分格中心角色区
  if (bubble && bubble.tailTipX === undefined && bubble.tailTipY === undefined) {
    const curTail = bubble.tail ?? 'bl'
    const curUp = curTail === 'tl' || curTail === 'tr'
    const curLeft = curTail === 'tl' || curTail === 'bl'
    const nextUp = pos.y > 0.62 ? true : pos.y < 0.48 ? false : curUp
    const nextLeft = pos.x > 0.56 ? true : pos.x < 0.44 ? false : curLeft
    patch.tail = nextUp ? (nextLeft ? 'tl' : 'tr') : nextLeft ? 'bl' : 'br'
  }
  commit(updateComicBubble(page.value, panelId, bubbleId, patch), { persist: false })
}

function onResizePanel(panelId: string, span: { colSpan: number; rowSpan: number }): void {
  const panel = page.value.panels.find((item) => item.id === panelId)
  if (!panel) return
  if (panel.colSpan === span.colSpan && panel.rowSpan === span.rowSpan) return
  commit(upsertComicPanel(page.value, { ...panel, ...span }), { persist: false })
}

function onResizeBubble(panelId: string, bubbleId: string, scale: number): void {
  const panel = page.value.panels.find((item) => item.id === panelId)
  const bubble = panel?.bubbles.find((item) => item.id === bubbleId)
  if (!bubble || (bubble.scale ?? 1) === scale) return
  commit(updateComicBubble(page.value, panelId, bubbleId, { scale }), { persist: false })
}

function onSelect(hit: ComicPageCanvasHit): void {
  if (hit.kind === 'bubble') {
    selectedPanelId.value = hit.panelId
    selectedBubbleId.value = hit.bubbleId
    return
  }
  if (hit.kind === 'panel') {
    selectedPanelId.value = hit.panelId
    selectedBubbleId.value = null
    return
  }
  selectedPanelId.value = null
  selectedBubbleId.value = null
}

function selectPanelFromTree(panelId: string): void {
  selectedPanelId.value = panelId
  selectedBubbleId.value = null
}

function selectBubbleFromTree(panelId: string, bubbleId: string): void {
  selectedPanelId.value = panelId
  selectedBubbleId.value = bubbleId
}

function onGlobalKeyDown(e: KeyboardEvent): void {
  const target = e.target as HTMLElement | null
  if (
    target &&
    (target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT' ||
      target.isContentEditable)
  ) {
    return
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault()
    e.stopImmediatePropagation()
    if (e.shiftKey) redo()
    else undo()
    return
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
    e.preventDefault()
    e.stopImmediatePropagation()
    redo()
    return
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
    if (selectedPanelId.value && selectedBubbleId.value) {
      e.preventDefault()
      onDuplicateBubble(selectedPanelId.value, selectedBubbleId.value)
    }
    return
  }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (selectedBubbleId.value || selectedPanelId.value) {
      e.preventDefault()
      deleteCurrentSelection()
    }
    return
  }
  if (e.key === 'PageUp' || e.key === 'PageDown') {
    const pages = graphComicPageNodes.value
    if (pages.length > 1) {
      e.preventDefault()
      const curIdx = pages.findIndex((item) => item.id === activeNodeId.value)
      const delta = e.key === 'PageDown' ? 1 : -1
      const nextIdx = ((curIdx >= 0 ? curIdx : 0) + delta + pages.length) % pages.length
      const nextNode = pages[nextIdx]
      if (nextNode) {
        switchActiveComicPageNode(nextNode.id)
      }
    }
    return
  }
  if (e.key === 'Tab') {
    const ordered = readingOrderPanels(page.value)
    if (ordered.length > 0) {
      e.preventDefault()
      const curIdx = ordered.findIndex((p) => p.id === selectedPanelId.value)
      const delta = e.shiftKey ? -1 : 1
      const nextIdx =
        curIdx < 0
          ? e.shiftKey
            ? ordered.length - 1
            : 0
          : (curIdx + delta + ordered.length) % ordered.length
      const targetPanel = ordered[nextIdx]
      if (targetPanel) {
        selectedPanelId.value = targetPanel.id
        selectedBubbleId.value = null
      }
    }
    return
  }
  if (
    e.key === 'ArrowUp' ||
    e.key === 'ArrowDown' ||
    e.key === 'ArrowLeft' ||
    e.key === 'ArrowRight'
  ) {
    if (selectedPanelId.value && selectedBubble.value) {
      e.preventDefault()
      const step = e.shiftKey ? 0.04 : 0.01
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0
      const nextX = Number(Math.max(0.04, Math.min(0.96, selectedBubble.value.x + dx)).toFixed(3))
      const nextY = Number(Math.max(0.04, Math.min(0.96, selectedBubble.value.y + dy)).toFixed(3))
      patchSelectedBubble({ x: nextX, y: nextY })
      return
    }
    if (selectedPanel.value) {
      e.preventDefault()
      const step = e.shiftKey ? 0.06 : 0.02
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0
      const curPanX = selectedPanel.value.imagePanX ?? 0
      const curPanY = selectedPanel.value.imagePanY ?? 0
      const nextPanX = Number(Math.max(-1, Math.min(1, curPanX + dx)).toFixed(2))
      const nextPanY = Number(Math.max(-1, Math.min(1, curPanY + dy)).toFixed(2))
      patchSelectedPanel({ imagePanX: nextPanX, imagePanY: nextPanY })
      return
    }
  }
}

let releaseDiveHistory: (() => void) | null = null

onMounted(() => {
  window.addEventListener('keydown', onGlobalKeyDown)
  releaseDiveHistory = diveEditorHistory.register({
    canUndo: () => canUndo.value,
    canRedo: () => canRedo.value,
    undo,
    redo
  })
})

onBeforeUnmount(() => {
  stopAnimaticPreview(false)
  window.removeEventListener('keydown', onGlobalKeyDown)
  releaseDiveHistory?.()
  releaseDiveHistory = null
})
</script>

<style scoped>
.comic-page-dive {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-panel);
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  padding: 8px 14px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-elevated);
}
.toolbar-group {
  display: flex;
  align-items: center;
  gap: 6px;
}
.tb-divider {
  width: 1px;
  height: 18px;
  background: var(--border);
  margin: 0 2px;
}
.tb-btn {
  padding: 5px 10px;
  font-size: 12px;
  color: var(--text);
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 6px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  transition:
    border-color 0.15s,
    background 0.15s;
}
.tb-btn:hover:not(:disabled) {
  border-color: var(--accent);
}
.tb-btn:disabled {
  opacity: 0.42;
  cursor: not-allowed;
}
.tb-btn--icon {
  padding: 5px 8px;
  font-weight: 700;
}
.page-switcher-group {
  gap: 4px;
}
.tb-btn--page {
  padding: 4px 8px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.tb-btn--active {
  color: var(--accent);
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}
.tb-btn--accent-soft {
  color: var(--accent);
  border-color: color-mix(in srgb, var(--accent) 50%, var(--border));
}
.tb-btn--danger:hover:not(:disabled) {
  color: #fff;
  background: var(--danger, #e11d48);
  border-color: var(--danger, #e11d48);
}
.tb-btn.done {
  color: #fff;
  background: var(--accent);
  border-color: var(--accent);
  font-weight: 600;
}
.page-spec-pill {
  font-size: 11px;
  color: var(--text-muted);
  padding: 3px 8px;
  border-radius: 999px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
}
.spacer {
  flex: 1;
}

.body {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr) 310px;
  gap: 12px;
  padding: 12px;
}

/* 左侧模板与素材坞 */
.left-dock {
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
}
.dock-tabs {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  border-bottom: 1px solid var(--border);
  background: var(--bg-panel);
}
.dock-tab {
  padding: 8px 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
}
.dock-tab--active {
  color: var(--accent);
  border-bottom-color: var(--accent);
  background: var(--bg-elevated);
}
.dock-content {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.dock-hint {
  margin: 0;
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.4;
}
.filter-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.filter-pill {
  padding: 3px 8px;
  font-size: 11px;
  color: var(--text-muted);
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 999px;
  cursor: pointer;
}
.filter-pill--active {
  color: #fff;
  background: var(--accent);
  border-color: var(--accent);
}

.template-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.template-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  text-align: left;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  cursor: pointer;
  transition:
    border-color 0.15s,
    transform 0.15s;
}
.template-card:hover {
  border-color: var(--accent);
  transform: translateY(-1px);
}
.template-thumb {
  width: 100%;
  height: 92px;
  border-radius: 4px;
  background: #0f172a;
}
.tpl-bg {
  fill: #f8fafc;
}
.tpl-panel {
  fill: #cbd5e1;
  stroke: #0f172a;
  stroke-width: 18;
}
.template-card:hover .tpl-panel {
  fill: color-mix(in srgb, var(--accent) 35%, #cbd5e1);
}
.template-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.template-name {
  font-size: 11px;
  font-weight: 600;
  color: var(--text);
}
.template-desc {
  font-size: 10px;
  color: var(--text-muted);
  line-height: 1.3;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.bubble-preset-grid,
.sfx-preset-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}
.bubble-preset-card {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px;
  font-size: 11px;
  color: var(--text);
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  cursor: pointer;
  text-align: left;
}
.bubble-preset-card:hover,
.sfx-card:hover {
  border-color: var(--accent);
}
.bp-icon {
  font-size: 15px;
}
.bp-name {
  font-weight: 500;
}
.sfx-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  padding: 8px 6px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  cursor: pointer;
}
.sfx-main {
  font-size: 14px;
  font-weight: 900;
  text-shadow:
    -1px -1px 0 #fff,
    1px -1px 0 #fff,
    -1px 1px 0 #fff,
    1px 1px 0 #fff;
}
.sfx-sub {
  font-size: 10px;
  color: var(--text-muted);
}

.canvas {
  min-width: 0;
  min-height: 0;
}

/* 右侧检查器 */
.side {
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-right: 2px;
}
.section-card {
  display: flex;
  flex-direction: column;
  gap: 9px;
  padding: 10px 12px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 10px;
}
.card-head-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.card-head-actions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}
.side h3 {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
}
.side label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
  color: var(--text-muted);
}
.side input:not([type='range']):not([type='color']),
.side textarea,
.side select {
  box-sizing: border-box;
  width: 100%;
  padding: 5px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-panel);
  color: var(--text);
  font-size: 12px;
}
.side input[type='range'] {
  width: 100%;
  accent-color: var(--accent);
}
.slider-head {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
}
.row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.row-3 {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}
.row-4 {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
}
.side input.color-input {
  box-sizing: border-box;
  width: 100%;
  height: 28px;
  padding: 2px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-panel);
  cursor: pointer;
}
.chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.chip-btn {
  padding: 4px 8px;
  font-size: 11px;
  color: var(--text);
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 6px;
  cursor: pointer;
}
.chip-btn:hover {
  border-color: var(--accent);
}
.chip-btn--active {
  color: #fff;
  background: var(--accent);
  border-color: var(--accent);
}
.segmented {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
  padding: 2px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 7px;
}
.segmented button {
  padding: 4px 6px;
  font-size: 11px;
  color: var(--text-muted);
  background: transparent;
  border: none;
  border-radius: 5px;
  cursor: pointer;
}
.segmented button.active {
  color: #fff;
  background: var(--accent);
}
.mini-btn {
  padding: 5px 8px;
  font-size: 11px;
  color: var(--text);
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 6px;
  cursor: pointer;
}
.mini-btn:hover:not(:disabled) {
  border-color: var(--accent);
}
.mini-btn--active {
  color: #fff;
  background: var(--accent);
  border-color: var(--accent);
}
.mini-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.hint {
  margin: 0;
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.4;
}
.field-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
}

/* 分镜与气泡层级树 */
.layer-tree-card {
  flex-shrink: 0;
}
.muted-count {
  font-size: 11px;
  color: var(--text-muted);
}
.layer-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 220px;
  overflow-y: auto;
}
.layer-panel-group {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.layer-item,
.layer-bubble-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  font-size: 11px;
  color: var(--text);
  background: var(--bg-panel);
  border: 1px solid transparent;
  border-radius: 6px;
  cursor: pointer;
}
.layer-bubble-item {
  margin-left: 16px;
  font-size: 10px;
  color: var(--text-muted);
}
.layer-item:hover,
.layer-bubble-item:hover {
  border-color: var(--border);
}
.layer-item--active {
  border-color: var(--accent) !important;
  background: color-mix(in srgb, var(--accent) 12%, var(--bg-panel));
  color: var(--text);
}
.layer-index {
  font-weight: 700;
  color: var(--accent);
}
.layer-name,
.layer-bubble-text {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.layer-tag {
  font-size: 11px;
}
</style>
