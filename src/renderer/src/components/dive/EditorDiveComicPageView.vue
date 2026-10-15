<template>
  <div class="dive-view comic-page-dive">
    <!-- 顶部专业工作台工具栏 -->
    <header class="toolbar">
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
          :disabled="page.panels.length === 0"
          @click="canvasRef?.exportPng()"
        >
          🖼 {{ t('graph.inspector.comicPage.exportPng') }}
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
      />

      <!-- 右侧：上下文精细属性面板 + 分镜图层树 -->
      <aside class="side">
        <!-- 1. 页面全局属性 -->
        <template v-if="showGlobal">
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
import {
  addComicBubble,
  addComicPanel,
  applyComicLayoutTemplate,
  COMIC_LAYOUT_TEMPLATES,
  comicOccupiedCellKeys,
  comicPanelPolygon,
  comicPanelRects,
  createComicPage,
  duplicateComicBubble,
  fillComicPageFromImageUrls,
  findEmptyComicCell,
  moveComicPanel,
  normalizeComicPage,
  parseComicPage,
  readComicPageFromGenParams,
  removeComicBubble,
  removeComicPanel,
  serializeComicPage,
  slantPresetToCornerOffsets,
  swapComicPanelContents,
  updateComicBubble,
  upsertComicPanel,
  withComicPageLayout,
  type ComicBubbleShape,
  type ComicBubbleTail,
  type ComicBubbleWritingMode,
  type ComicLayoutTemplate,
  type ComicPage,
  type ComicPanel,
  type ComicPanelEffectType,
  type ComicPanelFilter,
  type ComicPanelSlantPreset,
  type ComicSpeechBubble
} from '@shared/graph'
import { editorDiveKey } from '../../features/graph/model/editorDive'
import { graphEditorHosts } from '../../features/graph/model/graphEditorHosts'
import { diveEditorHistory } from '../../features/graph/ui/diveEditorHistory'
import { useEditorDiveFrameFlush } from '../../composables/useEditorDiveFrameFlush'
import { useStudioI18n } from '../../composables/useStudioI18n'
import ComicPageCanvas, { type ComicPageCanvasHit } from '../ComicPageCanvas.vue'

const props = defineProps<{
  frameKey: string
  hostId: string
  nodeId: string
}>()

const { t, locale } = useStudioI18n()
const editorDive = inject(editorDiveKey, null)
const canvasRef = ref<{
  exportPng: () => Promise<void>
  fitToViewport: () => void
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

const node = computed(() => graphEditorHosts.getNode(props.hostId, props.nodeId))
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
    ...graphEditorHosts.listIncomingEdges(props.hostId, props.nodeId, 'in-image'),
    ...graphEditorHosts.listIncomingEdges(props.hostId, props.nodeId, 'in')
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

function load(): void {
  const current = node.value
  page.value = readComicPageFromGenParams(current?.params) ?? createComicPage()
  dirty.value = false
}

watch(
  () => [props.hostId, props.nodeId, graphEditorHosts.revision.value] as const,
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
  graphEditorHosts.updateNode(props.hostId, props.nodeId, {
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

function deleteCurrentSelection(): void {
  if (selectedBubbleId.value) {
    removeSelectedBubble()
  } else if (selectedPanelId.value) {
    removeSelectedPanel()
  }
}

function patchSelectedPanel(patch: Partial<ComicPanel>, options?: { persist?: boolean }): void {
  const current = selectedPanel.value
  if (!current) return
  commit(upsertComicPanel(page.value, { ...current, ...patch }), options)
}

function onCanvasUpdatePanel(panelId: string, patch: Partial<ComicPanel>, persistNow = true): void {
  const panel = page.value.panels.find((p) => p.id === panelId)
  if (!panel) return
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
  const offsets = slantPresetToCornerOffsets(preset)
  patchSelectedPanel({ cornerOffsets: offsets })
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
  commit(updateComicBubble(page.value, panelId, bubbleId, pos), { persist: false })
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
