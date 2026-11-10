<template>
  <div v-if="node" class="dive-film dive-view">
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
      </div>

      <!-- 影视工作台合一节点：4 阶段 Tab 切换 -->
      <div v-if="isWorkbenchNode" class="pipeline-tabs workbench-stage-tabs">
        <button
          v-for="stage in WORKBENCH_STAGES"
          :key="stage"
          type="button"
          class="pipeline-tab"
          :class="{ active: kind === stage }"
          @click="switchWorkbenchStage(stage)"
        >
          <span class="tab-type">{{ t(`graph.inspector.film.stageTabs.${stage}`) }}</span>
          <span v-if="stageBadge(stage)" class="tab-title"> · {{ stageBadge(stage) }}</span>
        </button>
      </div>

      <div class="header-right">
        <button
          v-if="isWorkbenchNode && hasInPort && runStatus !== 'running'"
          type="button"
          class="full-pipeline-btn"
          :disabled="blocked"
          :title="t('graph.inspector.film.runFullPipelineHint')"
          @click="handleRunFullPipeline"
        >
          ⚡ {{ t('graph.inspector.film.runFullPipeline') }}
        </button>
        <span v-if="isWorkbenchNode && runStatus !== 'running'" class="stage-run-hint">
          {{ t(`graph.inspector.film.runCurrentStage.${kind}`) }}：
        </span>
        <GraphNodeRunControl
          v-if="hasInPort"
          :status="stageRunStatus"
          :is-running="isGraphRunning"
          :blocked="blocked"
          @toggle="handleToggleRun"
        />
      </div>
    </header>

    <div class="workbench-body">
      <!-- 左侧配置与指令栏 -->
      <aside class="workbench-sidebar">
        <p class="hint">{{ t(`graph.inspector.film.hint.${kind}`) }}</p>

        <!-- 模型选择 -->
        <section v-if="kind !== 'shot'" class="group">
          <h3>{{ t('graph.inspector.film.models') }}</h3>
          <div class="model-config-item">
            <span class="model-config-label">{{
              kind === 'breakdown' || kind === 'review'
                ? t('graph.inspector.film.textModel')
                : t('graph.inspector.film.imageModel')
            }}</span>
            <div class="gen-model-row">
              <InstructionModelSelect
                v-model="primaryModelKey"
                :options="primaryOptions"
                :title="t('graph.inspector.film.models')"
                :empty-label="t('graph.inspector.film.noModel')"
                @change="persistModel('primary')"
              />
              <ImageGenerateParamsSelect
                v-if="(kind === 'cast' || kind === 'render') && primaryModelKey"
                v-model="imageGenerateParams"
                :model-key="primaryModelKey"
                @change="persistImageGenerateParams"
              />
            </div>
          </div>
          <template v-if="kind === 'render'">
            <div class="model-config-item">
              <span class="model-config-label">{{ t('graph.inspector.film.videoModel') }}</span>
              <div class="gen-model-row">
                <InstructionModelSelect
                  v-model="videoModelKey"
                  :options="videoOptions"
                  :title="t('graph.inspector.film.videoModel')"
                  :empty-label="t('graph.inspector.film.noModel')"
                  @change="persistModel('video')"
                />
                <VideoGenerateParamsSelect
                  v-if="videoModelKey"
                  v-model="videoGenerateParams"
                  :model-key="videoModelKey"
                  :hide-frame-mode="true"
                  :allow-auto-duration="true"
                  @change="persistVideoGenerateParams"
                />
              </div>
            </div>
            <div v-if="params.filmRenderQc" class="model-config-item">
              <span class="model-config-label">{{ t('graph.inspector.film.qcModel') }}</span>
              <div class="gen-model-row">
                <InstructionModelSelect
                  v-model="qcModelKey"
                  :options="textOptions"
                  :title="t('graph.inspector.film.qcModel')"
                  :empty-label="t('graph.inspector.film.noModel')"
                  @change="persistModel('qc')"
                />
              </div>
            </div>
          </template>
        </section>

        <!-- AI 漫剧 21 题材 Skill（自上游剧本同步） -->
        <section v-if="kind !== 'shot' && activeManjuGenreSpec" class="group manju-genre-section">
          <h3>{{ t('graph.inspector.film.manjuGenre.title') }}</h3>
          <div class="manju-genre-card">
            <div class="manju-genre-synced-badge">
              🎭
              {{
                isEnLocale
                  ? `${activeManjuGenreSpec.nameEn} (${activeManjuGenreSpec.nameZh})`
                  : activeManjuGenreSpec.nameZh
              }}
            </div>
            <div class="manju-genre-tags">
              <span class="tag">{{
                t('graph.inspector.film.manjuGenre.shotRange', {
                  min: activeManjuGenreSpec.shotCountRange[0],
                  max: activeManjuGenreSpec.shotCountRange[1]
                })
              }}</span>
              <span class="tag">{{
                t('graph.inspector.film.manjuGenre.durationRange', {
                  min: activeManjuGenreSpec.shotDurationRangeSec[0],
                  max: activeManjuGenreSpec.shotDurationRangeSec[1]
                })
              }}</span>
              <span class="tag">{{
                t('graph.inspector.film.manjuGenre.dialogueRange', {
                  min: activeManjuGenreSpec.dialogueCharsRange[0],
                  max: activeManjuGenreSpec.dialogueCharsRange[1]
                })
              }}</span>
            </div>
            <p class="hint">
              {{
                t('graph.inspector.film.manjuGenre.progressRule', {
                  rule: activeManjuGenreSpec.episodeProgressTemplateZh
                })
              }}
            </p>
            <button
              type="button"
              class="ghost-btn compact-btn"
              :class="{ applied: genreDefaultsApplied }"
              @click="applyManjuGenreDefaults"
            >
              {{
                genreDefaultsApplied
                  ? t('graph.inspector.film.manjuGenre.appliedDefaults', {
                      name: isEnLocale ? activeManjuGenreSpec.nameEn : activeManjuGenreSpec.nameZh,
                      shots: Math.round(
                        (activeManjuGenreSpec.shotCountRange[0] +
                          activeManjuGenreSpec.shotCountRange[1]) /
                          2
                      ),
                      dur: Math.round(
                        (activeManjuGenreSpec.shotDurationRangeSec[0] +
                          activeManjuGenreSpec.shotDurationRangeSec[1]) /
                          2
                      )
                    })
                  : t('graph.inspector.film.manjuGenre.applyDefaults')
              }}
            </button>
          </div>
        </section>

        <!-- 分镜拆解选项 -->
        <section v-if="kind === 'breakdown'" class="group">
          <h3>{{ t('graph.inspector.film.breakdownOptions') }}</h3>
          <div class="grid2">
            <label>
              {{ t('graph.inspector.film.targetShots') }}
              <input
                type="number"
                min="0"
                max="200"
                :value="params.filmTargetShots ?? 0"
                @change="patchNumber('filmTargetShots', $event, 0, 200)"
              />
            </label>
            <label>
              {{ t('graph.inspector.film.aspectRatio') }}
              <select
                :value="params.filmAspectRatio ?? '16:9'"
                @change="patchString('filmAspectRatio', $event)"
              >
                <option v-for="ratio in ASPECT_RATIOS" :key="ratio" :value="ratio">
                  {{ ratio }}
                </option>
              </select>
            </label>
          </div>
          <label>
            {{ t('graph.inspector.film.shotDurationSec') }}
            <input
              type="number"
              min="0"
              max="60"
              :value="params.filmShotDurationSec ?? 0"
              @change="patchNumber('filmShotDurationSec', $event, 0, 60)"
            />
          </label>
          <div class="shot-pills">
            <button
              v-for="preset in SHOT_DURATION_PRESETS"
              :key="preset"
              type="button"
              class="shot-pill"
              :class="{ active: (params.filmShotDurationSec ?? 0) === preset }"
              @click="patchParams({ filmShotDurationSec: preset })"
            >
              {{ preset === 0 ? t('graph.inspector.film.shotDurationAuto') : `${preset}s` }}
            </button>
          </div>
          <p class="hint">{{ t('graph.inspector.film.shotDurationHint') }}</p>
          <label>
            {{ t('graph.inspector.film.style') }}
            <input
              type="text"
              :value="params.filmStyle ?? ''"
              :placeholder="t('graph.inspector.film.stylePlaceholder')"
              @change="patchString('filmStyle', $event)"
            />
          </label>
          <label class="check">
            <input
              type="checkbox"
              :checked="params.filmForce === true"
              @change="patchBool('filmForce', $event)"
            />
            {{ t('graph.inspector.film.forceBreakdown') }}
          </label>
        </section>

        <!-- 导演审核选项 -->
        <section v-if="kind === 'review'" class="group">
          <h3>{{ t('graph.inspector.film.reviewOptions') }}</h3>
          <label>
            {{ t('graph.inspector.film.maxRounds') }}
            <input
              type="number"
              min="0"
              max="5"
              :value="params.filmReviewMaxRounds ?? 2"
              @change="patchNumber('filmReviewMaxRounds', $event, 0, 5)"
            />
          </label>
          <p class="hint">{{ t('graph.inspector.film.maxRoundsHint') }}</p>
        </section>

        <!-- 角色场景设定选项 -->
        <section v-if="kind === 'cast'" class="group">
          <h3>{{ t('graph.inspector.film.castOptions') }}</h3>
          <div class="checks">
            <label v-for="castKind in CAST_KINDS" :key="castKind" class="check">
              <input
                type="checkbox"
                :checked="castKinds.includes(castKind)"
                @change="toggleCastKind(castKind)"
              />
              {{ t(`graph.inspector.film.kind.${castKind}`) }}
            </label>
          </div>
          <label class="inline">
            {{ t('graph.inspector.film.concurrency') }}
            <input
              type="number"
              min="1"
              max="8"
              :value="params.filmRenderConcurrency ?? 3"
              @change="patchNumber('filmRenderConcurrency', $event, 1, 8)"
            />
          </label>
          <label class="check">
            <input
              type="checkbox"
              :checked="params.filmEnableStyleAnchor === true"
              @change="patchBool('filmEnableStyleAnchor', $event)"
            />
            {{ t('graph.inspector.film.manjuGenre.enableStyleAnchor') }}
          </label>
          <label class="check">
            <input
              type="checkbox"
              :checked="params.filmUseSharedCast !== false"
              @change="patchBool('filmUseSharedCast', $event)"
            />
            {{ t('graph.inspector.film.castManju.useSharedCastToggle') }}
          </label>
          <label class="check">
            <input
              type="checkbox"
              :checked="params.filmForce === true"
              @change="patchBool('filmForce', $event)"
            />
            {{ t('graph.inspector.film.force') }}
          </label>
          <p class="hint">{{ t('graph.inspector.film.castRefHint') }}</p>
        </section>

        <!-- 单镜装配选项 -->
        <section v-if="kind === 'shot'" class="group">
          <h3>{{ t('graph.inspector.film.shotRef') }}</h3>
          <div class="stepper">
            <button type="button" @click="stepShot(-1)">‹</button>
            <input
              type="text"
              :value="params.filmShotRef ?? '1'"
              @change="patchString('filmShotRef', $event)"
            />
            <button type="button" @click="stepShot(1)">›</button>
          </div>
          <p class="hint">{{ t('graph.inspector.film.shotRefHint') }}</p>
          <div v-if="effectiveStoryboard?.shots.length" class="shot-pills">
            <button
              v-for="(s, idx) in effectiveStoryboard.shots"
              :key="s.id"
              type="button"
              class="shot-pill"
              :class="{ active: selectedShot?.id === s.id }"
              @click="selectShotRef(String(idx + 1))"
            >
              #{{ idx + 1 }} {{ s.id }}
            </button>
          </div>
        </section>

        <!-- 批量拍摄选项 -->
        <section v-if="kind === 'render'" class="group">
          <h3>{{ t('graph.inspector.film.renderOptions') }}</h3>
          <div class="segmented">
            <button
              v-for="mode in RENDER_MODES"
              :key="mode"
              type="button"
              :class="{ active: (params.filmRenderMode ?? 'keyframe') === mode }"
              @click="setRenderMode(mode)"
            >
              {{ t(`graph.inspector.film.mode.${mode}`) }}
            </button>
          </div>
          <div class="grid2">
            <label>
              {{ t('graph.inspector.film.aspectRatio') }}
              <select
                :value="params.generateAspectRatio ?? ''"
                @change="patchString('generateAspectRatio', $event)"
              >
                <option value="">{{ t('graph.inspector.film.followStoryboard') }}</option>
                <option v-for="ratio in ASPECT_RATIOS" :key="ratio" :value="ratio">
                  {{ ratio }}
                </option>
              </select>
            </label>
            <label>
              {{ t('graph.inspector.film.shotRange') }}
              <input
                type="text"
                :value="params.filmShotRange ?? ''"
                :placeholder="t('graph.inspector.film.shotRangePlaceholder')"
                @change="patchString('filmShotRange', $event)"
              />
            </label>
          </div>
          <label class="inline">
            {{ t('graph.inspector.film.concurrency') }}
            <input
              type="number"
              min="1"
              max="8"
              :value="params.filmRenderConcurrency ?? 3"
              @change="patchNumber('filmRenderConcurrency', $event, 1, 8)"
            />
          </label>
          <label class="check">
            <input
              type="checkbox"
              :checked="params.filmRenderContinuity !== false"
              @change="patchBool('filmRenderContinuity', $event)"
            />
            {{ t('graph.inspector.film.continuity') }}
          </label>
          <label class="check">
            <input
              type="checkbox"
              :checked="params.filmRenderPrevizVideoRef !== false"
              @change="patchBool('filmRenderPrevizVideoRef', $event)"
            />
            {{ t('graph.inspector.film.previzVideoRefToggle') }}
          </label>
          <label class="check">
            <input
              type="checkbox"
              :checked="params.filmRenderAudio !== false"
              @change="patchBool('filmRenderAudio', $event)"
            />
            {{ t('graph.inspector.film.renderAudioToggle') }}
          </label>
          <label class="check">
            <input
              type="checkbox"
              :checked="params.filmRenderQc === true"
              @change="patchBool('filmRenderQc', $event)"
            />
            {{ t('graph.inspector.film.qc') }}
          </label>
          <label v-if="params.filmRenderQc" class="inline">
            {{ t('graph.inspector.film.maxRetries') }}
            <input
              type="number"
              min="0"
              max="3"
              :value="params.filmRenderMaxRetries ?? 1"
              @change="patchNumber('filmRenderMaxRetries', $event, 0, 3)"
            />
          </label>
          <label class="check">
            <input
              type="checkbox"
              :checked="params.filmForce === true"
              @change="patchBool('filmForce', $event)"
            />
            {{ t('graph.inspector.film.force') }}
          </label>
          <p class="hint">{{ t('graph.inspector.film.renderCacheHint') }}</p>
        </section>

        <!-- 导演 / 补充指令 -->
        <section v-if="kind !== 'shot' && kind !== 'publish'" class="group">
          <h3>{{ t(`graph.inspector.film.instruction.${kind}`) }}</h3>
          <textarea
            rows="4"
            :value="currentInstruction"
            :placeholder="t(`graph.inspector.film.instructionPlaceholder.${kind}`)"
            @change="patchCurrentInstruction($event)"
          />
        </section>
      </aside>

      <!-- 右侧大屏主工作区 -->
      <main class="workbench-main">
        <!-- 审核结论与报告横幅 -->
        <section
          v-if="
            kind === 'review' &&
            (params.filmReviewVerdict || params.filmReviewReport || effectiveStoryboard?.review)
          "
          class="review-banner"
        >
          <div class="review-head">
            <span
              v-if="params.filmReviewVerdict || effectiveStoryboard?.review?.verdict"
              class="verdict"
              :class="
                (params.filmReviewVerdict || effectiveStoryboard?.review?.verdict) === 'PASS'
                  ? 'pass'
                  : 'fail'
              "
            >
              {{ params.filmReviewVerdict || effectiveStoryboard?.review?.verdict }}
            </span>
            <span v-if="effectiveStoryboard?.review?.score != null" class="score-chip">
              {{ effectiveStoryboard.review.score }} / 100
            </span>
          </div>
          <pre v-if="params.filmReviewReport" class="report">{{ params.filmReviewReport }}</pre>
        </section>

        <!-- 阶段四第3部分 · 11 项工业连戏与逻辑自动审计面板 -->
        <section
          v-if="(kind === 'review' || kind === 'breakdown') && liveContinuityAudit"
          class="manju-audit-panel"
        >
          <div class="section-head">
            <div class="manju-audit-title-row">
              <h3>{{ t('graph.inspector.film.auditPanel.title') }}</h3>
              <span class="verdict" :class="liveContinuityAudit.passed ? 'pass' : 'fail'">
                {{ liveContinuityAudit.passed ? 'PASS' : 'FAIL' }}
              </span>
              <span class="score-chip">{{ liveContinuityAudit.score }} / 100</span>
            </div>
            <span class="tag">
              {{
                t('graph.inspector.film.auditPanel.spokenStats', {
                  ratio: Math.round(liveContinuityAudit.spokenRatio * 100),
                  spoken: liveContinuityAudit.spokenDialogueChars,
                  total: liveContinuityAudit.totalDialogueChars
                })
              }}
            </span>
          </div>
          <div class="manju-audit-grid">
            <div
              v-for="chk in liveContinuityAudit.items"
              :key="chk.id"
              class="manju-audit-item"
              :class="chk.passed ? 'pass' : 'fail'"
            >
              <span class="manju-audit-status" :class="chk.passed ? 'pass' : 'fail'">
                {{ chk.passed ? 'PASS' : 'FAIL' }}
              </span>
              <div class="manju-audit-body">
                <strong>{{ isEnLocale ? chk.labelEn : chk.labelZh }}</strong>
                <span>{{ chk.detail }}</span>
              </div>
            </div>
          </div>
        </section>

        <!-- ① 分镜拆解 / 导演审核：项目圣经 + 实体条 + 大屏分镜卡片网格 -->
        <template v-if="kind === 'breakdown' || kind === 'review'">
          <template v-if="displayStoryboard && displayStoryboard.shots.length">
            <p v-if="kind === 'review' && !storyboard?.shots?.length" class="draft-banner">
              {{ t('graph.inspector.film.upstreamDraftHint') }}
            </p>

            <!-- 阶段一 · 项目圣经 & 阶段三 · 单集爽点钩子 -->
            <section
              v-if="displayStoryboard.bible || displayStoryboard.episodeMeta"
              class="manju-bible-panel"
            >
              <div class="section-head">
                <h3>{{ t('graph.inspector.film.biblePanel.title') }}</h3>
                <div class="manju-bible-badges">
                  <span v-if="activeManjuGenreSpec" class="badge accent">
                    {{ isEnLocale ? activeManjuGenreSpec.nameEn : activeManjuGenreSpec.nameZh }}
                  </span>
                  <span v-if="displayStoryboard.episodeMeta?.episodeProgress" class="tag">
                    {{ t('graph.inspector.film.biblePanel.episodeProgress') }}:
                    {{ displayStoryboard.episodeMeta.episodeProgress }}
                  </span>
                </div>
              </div>
              <div v-if="displayStoryboard.episodeMeta" class="manju-hook-row">
                <div v-if="displayStoryboard.episodeMeta.coldOpen" class="manju-hook-card">
                  <span class="manju-hook-label">
                    ⚡ {{ t('graph.inspector.film.biblePanel.coldOpen') }}
                  </span>
                  <span>{{ displayStoryboard.episodeMeta.coldOpen }}</span>
                </div>
                <div v-if="displayStoryboard.episodeMeta.cliffhangerHook" class="manju-hook-card">
                  <span class="manju-hook-label">
                    🪝 {{ t('graph.inspector.film.biblePanel.cliffhanger') }}
                  </span>
                  <span>{{ displayStoryboard.episodeMeta.cliffhangerHook }}</span>
                </div>
              </div>
              <div v-if="displayStoryboard.bible" class="manju-bible-meta">
                <span v-if="displayStoryboard.bible.worldAndPowerSystem" class="tag">
                  💡 {{ displayStoryboard.bible.worldAndPowerSystem }}
                </span>
                <span v-if="displayStoryboard.bible.colorScheme" class="tag">
                  🎨 {{ displayStoryboard.bible.colorScheme }}
                </span>
                <span v-if="displayStoryboard.bible.continuityRules?.length" class="tag danger-tag">
                  🚫 {{ t('graph.inspector.film.biblePanel.redlines') }}:
                  {{ displayStoryboard.bible.continuityRules.join(' · ') }}
                </span>
              </div>
            </section>

            <section v-if="displayStoryboard.entities.length" class="entities-bar">
              <div class="section-head">
                <h3>
                  {{
                    t('graph.inspector.film.entitiesTitle', {
                      n: displayStoryboard.entities.length
                    })
                  }}
                </h3>
              </div>
              <div class="entity-chips">
                <div
                  v-for="ent in displayStoryboard.entities"
                  :key="ent.id"
                  class="entity-chip"
                  :title="ent.description"
                >
                  <img
                    v-if="entityThumbUrl(ent.kind, ent.name)"
                    :src="entityThumbUrl(ent.kind, ent.name)"
                    :alt="ent.name"
                    class="entity-mini-thumb"
                    @click.stop="previewMedia(entityThumbUrl(ent.kind, ent.name), ent.name)"
                  />
                  <span v-if="ent.code" class="badge code-badge">{{ ent.code }}</span>
                  <span class="badge">{{ t(`graph.inspector.film.kind.${ent.kind}`) }}</span>
                  <strong>{{ ent.name }}</strong>
                  <span v-if="ent.stateCode" class="tag">{{ ent.stateCode }}</span>
                  <span v-if="ent.heightCm" class="tag">{{ ent.heightCm }}cm</span>
                  <span class="tag">{{
                    t('graph.inspector.film.usedInShots', {
                      n: shotsUsingEntity(ent.kind, ent.name).length
                    })
                  }}</span>
                  <span v-if="ent.description" class="entity-desc">{{ ent.description }}</span>
                </div>
              </div>
            </section>

            <section class="shots-section">
              <div class="section-head">
                <div>
                  <h3>
                    {{ t('graph.inspector.film.shots', { n: displayStoryboard.shots.length }) }}
                  </h3>
                  <p class="hint">{{ t('graph.inspector.film.workbenchShotsHint') }}</p>
                </div>
                <div
                  v-if="storyboard?.shots?.length || displayStoryboard?.shots?.length"
                  class="batch-actions"
                >
                  <button
                    type="button"
                    class="ghost-btn previz-stage-btn"
                    :disabled="previzOpeningKey !== null"
                    :title="t('graph.inspector.film.openDirectorPrevizHint')"
                    @click="openInDirectorPreviz()"
                  >
                    {{ previzOpeningKey === '__all__' ? '⏳' : '🧊' }}
                    {{ t('graph.inspector.film.openDirectorPreviz') }}
                  </button>
                  <template v-if="storyboard?.shots?.length">
                    <button type="button" class="ghost-btn" @click="setAllShotsLock(true)">
                      🔒 {{ t('graph.inspector.film.lockAll') }}
                    </button>
                    <button type="button" class="ghost-btn" @click="setAllShotsLock(false)">
                      🔓 {{ t('graph.inspector.film.unlockAll') }}
                    </button>
                  </template>
                </div>
              </div>

              <div class="shot-grid">
                <article
                  v-for="(shot, idx) in displayStoryboard.shots"
                  :key="shot.id"
                  class="shot-card"
                  :class="{ fail: shot.review?.verdict === 'fail', locked: isLocked(shot) }"
                >
                  <div class="shot-card-head">
                    <span class="shot-index">#{{ idx + 1 }}</span>
                    <span class="sid">{{ shot.id }}</span>
                    <span v-if="shot.timeRange" class="tag">{{ shot.timeRange }}</span>
                    <span class="meta">
                      {{
                        [shot.shotSize, shot.angle, shot.cameraMove, shot.focalLength]
                          .filter(Boolean)
                          .join(' · ')
                      }}
                      · {{ shot.durationSec }}s
                    </span>
                    <span class="status-pill" :class="isShotLipSync(shot) ? 'ok' : ''">
                      {{
                        isShotLipSync(shot)
                          ? `🗣️ ${t('graph.inspector.film.shotManju.lipSyncShot')}`
                          : `🤐 ${t('graph.inspector.film.shotManju.closedMouthShot')}`
                      }}
                    </span>
                    <span class="spacer" />
                    <button
                      type="button"
                      class="ghost-btn compact-btn"
                      :class="{ active: isShotAbExpanded(shot.id) }"
                      @click="toggleShotAbDrawer(shot.id)"
                    >
                      🎬 {{ t('graph.inspector.film.shotManju.abSectionToggle') }}
                    </button>
                    <button
                      type="button"
                      class="ghost-btn compact-btn"
                      :disabled="previzOpeningKey !== null"
                      :title="t('graph.inspector.film.openShotPrevizHint')"
                      @click="openInDirectorPreviz({ shotId: shot.id })"
                    >
                      {{ previzOpeningKey === shot.id ? '⏳' : '🧊' }}
                      {{ t('graph.inspector.film.openShotPreviz') }}
                    </button>
                    <button
                      v-if="storyboard?.shots?.length"
                      type="button"
                      class="lock"
                      :class="{ on: isLocked(shot) }"
                      :title="t('graph.inspector.film.lockHint')"
                      @click="toggleShotLock(shot.id)"
                    >
                      {{ isLocked(shot) ? '🔒' : '🔓' }}
                    </button>
                  </div>

                  <!-- 角色与场景可视化绑定栏 -->
                  <div class="shot-binding-panel">
                    <div class="binding-chips">
                      <div
                        v-for="item in shotBindingItems(shot)"
                        :key="`${item.kind}:${item.name}`"
                        class="binding-chip"
                        :class="[item.kind, { ready: item.refIndex > 0 }]"
                      >
                        <img
                          v-if="item.thumbUrl"
                          :src="item.thumbUrl"
                          :alt="item.name"
                          class="binding-thumb"
                          @click.stop="previewMedia(item.thumbUrl, item.name)"
                        />
                        <span class="badge">{{ t(`graph.inspector.film.kind.${item.kind}`) }}</span>
                        <strong class="binding-name">{{ item.name }}</strong>
                        <span v-if="item.refIndex > 0" class="ref-badge ready">
                          {{ t('graph.inspector.film.refSheetReady', { n: item.refIndex }) }}
                        </span>
                        <span v-else class="ref-badge pending">
                          {{ t('graph.inspector.film.refSheetMissing') }}
                        </span>
                        <button
                          v-if="storyboard?.shots?.length"
                          type="button"
                          class="binding-remove"
                          @click="unbindEntityFromShot(shot.id, item.kind, item.name)"
                        >
                          ×
                        </button>
                      </div>
                      <div
                        v-if="prevSameSceneShot(shot)"
                        class="binding-chip continuity"
                        :class="{ ready: !!shotKeyframeThumbUrl(prevSameSceneShot(shot)!) }"
                        :title="
                          t('graph.inspector.film.continuityHint', {
                            id: prevSameSceneShot(shot)!.id
                          })
                        "
                      >
                        <img
                          v-if="shotKeyframeThumbUrl(prevSameSceneShot(shot)!)"
                          :src="shotKeyframeThumbUrl(prevSameSceneShot(shot)!)"
                          :alt="prevSameSceneShot(shot)!.id"
                          :class="'binding-thumb'"
                          @click.stop="
                            previewMedia(
                              shotKeyframeThumbUrl(prevSameSceneShot(shot)!),
                              prevSameSceneShot(shot)!.id
                            )
                          "
                        />
                        <span class="badge">🔗</span>
                        <strong class="binding-name">
                          {{
                            t('graph.inspector.film.continuityFrom', {
                              id: prevSameSceneShot(shot)!.id
                            })
                          }}
                        </strong>
                        <span v-if="prevShotKeyframeRefIndex(shot) > 0" class="ref-badge ready">
                          {{
                            t('graph.inspector.film.refSheetReady', {
                              n: prevShotKeyframeRefIndex(shot)
                            })
                          }}
                        </span>
                      </div>
                      <div
                        v-if="shotRawPrevizKeyframe(shot)"
                        class="binding-chip previz ready"
                        :title="t('graph.inspector.film.previzRefHint')"
                      >
                        <img
                          v-if="shotPrevizThumbUrl(shot)"
                          :src="shotPrevizThumbUrl(shot)"
                          :alt="shot.id"
                          class="binding-thumb"
                          @click.stop="previewMedia(shotPrevizThumbUrl(shot), `${shot.id} Previz`)"
                        />
                        <span class="badge">🧊</span>
                        <strong class="binding-name">
                          {{ t('graph.inspector.film.previzRefLabel') }}
                        </strong>
                        <span v-if="shotPrevizRefIndex(shot, true) > 0" class="ref-badge ready">
                          {{
                            t('graph.inspector.film.refSheetReady', {
                              n: shotPrevizRefIndex(shot, true)
                            })
                          }}
                        </span>
                        <button
                          v-if="storyboard?.shots?.length"
                          type="button"
                          class="binding-remove"
                          @click="clearShotPreviz(shot.id)"
                        >
                          ×
                        </button>
                      </div>
                    </div>

                    <div v-if="storyboard?.shots?.length" class="binding-actions">
                      <select
                        v-if="availableLocations.length"
                        class="binding-select"
                        :value="shot.location || ''"
                        @change="patchShotLocation(shot.id, $event)"
                      >
                        <option value="">{{ t('graph.inspector.film.clearLocation') }}</option>
                        <option v-for="loc in availableLocations" :key="loc.id" :value="loc.name">
                          {{ t('graph.inspector.film.kind.location') }}: {{ loc.name }}
                        </option>
                      </select>
                      <button
                        v-for="ch in unboundCharactersForShot(shot)"
                        :key="ch.id"
                        type="button"
                        class="binding-add-btn"
                        @click="bindCharacterToShot(shot.id, ch.name)"
                      >
                        + {{ ch.name }}
                      </button>
                      <button
                        v-for="prop in unboundPropsForShot(shot)"
                        :key="prop.id"
                        type="button"
                        class="binding-add-btn"
                        @click="bindPropToShot(shot.id, prop.name)"
                      >
                        + {{ prop.name }}
                      </button>
                    </div>
                  </div>

                  <p
                    v-if="shot.review?.verdict === 'fail' && shot.review.notes"
                    class="review-note"
                  >
                    ⚠ {{ shot.review.notes }}
                  </p>

                  <div class="shot-meta-grid">
                    <label>
                      {{ t('graph.inspector.film.field.shotSize') }}
                      <input
                        type="text"
                        :value="shot.shotSize"
                        :readonly="!storyboard?.shots?.length"
                        @change="patchShot(shot.id, 'shotSize', $event)"
                      />
                    </label>
                    <label>
                      {{ t('graph.inspector.film.field.angle') }}
                      <input
                        type="text"
                        :value="shot.angle"
                        :readonly="!storyboard?.shots?.length"
                        @change="patchShot(shot.id, 'angle', $event)"
                      />
                    </label>
                    <label>
                      {{ t('graph.inspector.film.field.cameraMove') }}
                      <input
                        type="text"
                        :value="shot.cameraMove"
                        :readonly="!storyboard?.shots?.length"
                        @change="patchShot(shot.id, 'cameraMove', $event)"
                      />
                    </label>
                    <label>
                      {{ t('graph.inspector.film.field.durationSec') }}
                      <input
                        type="number"
                        min="1"
                        max="60"
                        :value="shot.durationSec"
                        :readonly="!storyboard?.shots?.length"
                        @change="patchShotDuration(shot.id, $event)"
                      />
                    </label>
                  </div>

                  <!-- 阶段四 · A段 5 行静态规格 & B段 7 行动态视频节拍抽屉 -->
                  <div v-if="isShotAbExpanded(shot.id)" class="shot-ab-drawer">
                    <div class="grid2">
                      <label>
                        {{ t('graph.inspector.film.shotManju.focalLength') }}
                        <input
                          type="text"
                          :value="shot.focalLength ?? ''"
                          :readonly="!storyboard?.shots?.length"
                          @change="patchShotManjuField(shot.id, 'focalLength', $event)"
                        />
                      </label>
                      <label>
                        {{ t('graph.inspector.film.shotManju.subjectPosition') }}
                        <input
                          type="text"
                          :value="shot.subjectPosition ?? ''"
                          :readonly="!storyboard?.shots?.length"
                          @change="patchShotManjuField(shot.id, 'subjectPosition', $event)"
                        />
                      </label>
                    </div>
                    <label>
                      {{ t('graph.inspector.film.shotManju.blockingAndPose') }}
                      <input
                        type="text"
                        :value="shot.blockingAndPose ?? ''"
                        :readonly="!storyboard?.shots?.length"
                        @change="patchShotManjuField(shot.id, 'blockingAndPose', $event)"
                      />
                    </label>
                    <div class="grid2">
                      <label>
                        {{ t('graph.inspector.film.shotManju.expression') }}
                        <input
                          type="text"
                          :value="shot.expression ?? ''"
                          :readonly="!storyboard?.shots?.length"
                          @change="patchShotManjuField(shot.id, 'expression', $event)"
                        />
                      </label>
                      <label>
                        {{ t('graph.inspector.film.shotManju.lighting') }}
                        <input
                          type="text"
                          :value="shot.lighting ?? ''"
                          :readonly="!storyboard?.shots?.length"
                          @change="patchShotManjuField(shot.id, 'lighting', $event)"
                        />
                      </label>
                    </div>
                    <div v-if="shotVideoBeats(shot).length" class="shot-beats-box">
                      <strong class="shot-beats-title">
                        {{ t('graph.inspector.film.shotManju.videoBeatsTitle') }}
                      </strong>
                      <div
                        v-for="(beat, bIdx) in shotVideoBeats(shot)"
                        :key="bIdx"
                        class="shot-beat-row"
                      >
                        <span class="badge code-badge">{{ beat.timeRange }}</span>
                        <span>{{ beat.cameraMove }} · {{ beat.visual }}</span>
                        <span v-if="beat.sound" class="tag">🔊 {{ beat.sound }}</span>
                      </div>
                    </div>
                  </div>

                  <label>
                    {{ t('graph.inspector.film.field.action') }}
                    <textarea
                      rows="2"
                      :value="shot.action"
                      :readonly="!storyboard?.shots?.length"
                      @change="patchShot(shot.id, 'action', $event)"
                    />
                  </label>
                  <label>
                    {{ t('graph.inspector.film.field.imagePrompt') }}
                    <textarea
                      rows="3"
                      :value="shot.imagePrompt"
                      :readonly="!storyboard?.shots?.length"
                      @change="patchShot(shot.id, 'imagePrompt', $event)"
                    />
                  </label>
                  <label>
                    {{ t('graph.inspector.film.field.videoPrompt') }}
                    <textarea
                      rows="2"
                      :value="shot.videoPrompt"
                      :readonly="!storyboard?.shots?.length"
                      @change="patchShot(shot.id, 'videoPrompt', $event)"
                    />
                  </label>

                  <div v-if="shot.dialogue?.length" class="dialogue-list">
                    <div
                      v-for="(line, lineIdx) in shot.dialogue"
                      :key="lineIdx"
                      class="dialogue-line"
                    >
                      <span class="badge">
                        {{
                          t(`graph.inspector.film.shotManju.dialogueMode.${line.mode || 'spoken'}`)
                        }}
                      </span>
                      <span v-if="line.startSec != null && line.endSec != null" class="tag">
                        {{ line.startSec }}-{{ line.endSec }}s
                      </span>
                      <strong>{{ line.speaker }}:</strong> {{ line.line }}
                    </div>
                  </div>
                </article>
              </div>
            </section>
          </template>
          <div v-else class="empty-panel">
            <strong class="empty-title">{{ activeTabLabel }}</strong>
            <span>
              {{
                kind === 'breakdown'
                  ? t('graph.inspector.film.emptyBreakdown')
                  : t('graph.inspector.film.emptyReview')
              }}
            </span>
            <span class="empty-sub">{{ t(`graph.inspector.film.hint.${kind}`) }}</span>
          </div>
        </template>

        <!-- ② 角色场景设定：设定卡片网格 + 设定图输出预览 -->
        <template v-else-if="kind === 'cast'">
          <section v-if="castEntries.length" class="shots-section">
            <div class="section-head">
              <div class="manju-audit-title-row">
                <h3>{{ t('graph.inspector.film.entitiesTitle', { n: castEntries.length }) }}</h3>
                <span v-if="sharedSeriesBibleCastCount > 0" class="badge accent">
                  {{
                    t('graph.inspector.film.castManju.sharedCastActiveBadge', {
                      n: sharedSeriesBibleCastCount
                    })
                  }}
                </span>
              </div>
              <div class="batch-actions">
                <button
                  type="button"
                  class="ghost-btn previz-stage-btn"
                  :class="{ active: params.filmIsSeriesBibleCast === true }"
                  @click="syncCurrentCastAsSeriesBible"
                >
                  {{
                    params.filmIsSeriesBibleCast === true
                      ? t('graph.inspector.film.castManju.syncedSeriesBibleBtn')
                      : t('graph.inspector.film.castManju.syncSeriesBibleBtn')
                  }}
                </button>
              </div>
            </div>
            <div class="cast-grid">
              <article
                v-for="entry in castEntries"
                :key="entry.id"
                class="cast-card"
                :class="{ locked: entry.locked }"
              >
                <div class="cast-card-head">
                  <span v-if="entry.code" class="badge code-badge">{{ entry.code }}</span>
                  <span class="badge">{{ t(`graph.inspector.film.kind.${entry.kind}`) }}</span>
                  <strong class="cast-name">{{ entry.name }}</strong>
                  <span v-if="entry.stateCode" class="tag">{{ entry.stateCode }}</span>
                  <span v-if="entry.heightCm" class="tag">{{ entry.heightCm }}cm</span>
                  <span v-if="entry.voicePreset" class="tag">🎙️ {{ entry.voicePreset }}</span>
                  <span
                    class="state"
                    :class="{ ok: !!(entry.imageRelativePath || entry.imageUrl) }"
                  >
                    {{ entry.imageRelativePath || entry.imageUrl ? '✓' : '—' }}
                  </span>
                  <button
                    type="button"
                    class="card-run-btn"
                    :disabled="runStatus === 'running' || blocked"
                    @click="runSingleCastEntry(entry.id)"
                  >
                    {{
                      runStatus === 'running' && runningTargetId === entry.id
                        ? t('graph.inspector.film.runningSingle')
                        : entry.imageRelativePath || entry.imageUrl
                          ? `↻ ${t('graph.inspector.film.rerunCastEntry')}`
                          : `▶ ${t('graph.inspector.film.runCastEntry')}`
                    }}
                  </button>
                  <button
                    type="button"
                    class="lock"
                    :class="{ on: entry.locked }"
                    :title="t('graph.inspector.film.lockHint')"
                    @click="toggleCastLock(entry.id)"
                  >
                    {{ entry.locked ? '🔒' : '🔓' }}
                  </button>
                </div>

                <!-- 设定图直出缩略图预览 -->
                <div
                  v-if="mediaThumbUrl(entry.imageRelativePath || entry.imageUrl)"
                  class="card-media-preview"
                  @click="
                    previewMedia(
                      mediaThumbUrl(entry.imageRelativePath || entry.imageUrl),
                      entry.name
                    )
                  "
                >
                  <img
                    :src="mediaThumbUrl(entry.imageRelativePath || entry.imageUrl)"
                    :alt="entry.name"
                  />
                </div>

                <!-- 阶段二 · 资产工业标尺与锚点元数据 -->
                <div v-if="entry.kind === 'character'" class="grid2">
                  <label>
                    {{ t('graph.inspector.film.castManju.stateCode') }}
                    <input
                      type="text"
                      :value="entry.stateCode ?? ''"
                      placeholder="LOOK-A / LOOK-B"
                      @change="patchCastField(entry.id, 'stateCode', $event)"
                    />
                  </label>
                  <label>
                    {{ t('graph.inspector.film.castManju.heightCm') }}
                    <input
                      type="number"
                      min="40"
                      max="300"
                      :value="entry.heightCm ?? ''"
                      placeholder="178"
                      @change="patchCastHeight(entry.id, $event)"
                    />
                  </label>
                  <label class="cast-voice-label">
                    {{ t('graph.inspector.film.castManju.voicePreset') }}
                    <select
                      :value="entry.voicePreset ?? 'alloy'"
                      @change="patchCastVoicePreset(entry.id, $event)"
                    >
                      <option
                        v-for="preset in FILM_TTS_VOICE_PRESETS"
                        :key="preset.id"
                        :value="preset.id"
                      >
                        {{ isEnLocale ? preset.labelEn : preset.labelZh }}
                      </option>
                    </select>
                  </label>
                </div>
                <div v-else-if="entry.kind === 'location' || entry.kind === 'prop'" class="grid2">
                  <label>
                    {{ t('graph.inspector.film.castManju.dimensions') }}
                    <input
                      type="text"
                      :value="entry.dimensions ?? ''"
                      @change="patchCastField(entry.id, 'dimensions', $event)"
                    />
                  </label>
                  <label v-if="entry.kind === 'location'">
                    {{ t('graph.inspector.film.castManju.worldLightDirection') }}
                    <input
                      type="text"
                      :value="entry.worldLightDirection ?? ''"
                      @change="patchCastField(entry.id, 'worldLightDirection', $event)"
                    />
                  </label>
                </div>

                <label>
                  {{ t('graph.inspector.film.field.description') }}
                  <textarea
                    rows="3"
                    :value="entry.description"
                    @change="patchCastDescription(entry.id, $event)"
                  />
                </label>

                <!-- 该角色/地点关联的分镜列表 -->
                <div class="cast-used-shots">
                  <span class="pipeline-label">
                    {{
                      shotsUsingEntity(entry.kind, entry.name).length
                        ? t('graph.inspector.film.usedInShots', {
                            n: shotsUsingEntity(entry.kind, entry.name).length
                          })
                        : t('graph.inspector.film.noUsedShots')
                    }}
                  </span>
                  <span
                    v-for="s in shotsUsingEntity(entry.kind, entry.name)"
                    :key="s.id"
                    class="tag"
                    :title="s.action || s.imagePrompt"
                  >
                    {{ s.id }}
                  </span>
                </div>
              </article>
            </div>
          </section>
          <div v-else class="empty-panel">
            <strong class="empty-title">
              {{ activeTabLabel }} · {{ selectedCastKindsLabel }}
            </strong>
            <span>{{ t('graph.inspector.film.emptyCast') }}</span>
            <span class="empty-sub">{{ t('graph.inspector.film.hint.cast') }}</span>
          </div>

          <section v-if="hasCastOutputs" class="output-section">
            <h3>{{ t('graph.inspector.outputPreview') }}</h3>
            <GraphNodeOutputPreview
              v-if="hostId"
              :node="node"
              :host-id="hostId"
              port-id="out-sheets"
            />
          </section>
        </template>

        <!-- ③ 镜头装配：单镜详情与提示词预览 -->
        <template v-else-if="kind === 'shot'">
          <section v-if="selectedShot" class="shots-section">
            <div class="section-head">
              <h3>{{ t('graph.inspector.film.shotPreviewTitle') }} · {{ selectedShot.id }}</h3>
            </div>
            <article class="shot-card">
              <div class="shot-card-head">
                <span class="sid">{{ selectedShot.id }}</span>
                <span class="meta">
                  {{
                    [selectedShot.shotSize, selectedShot.angle, selectedShot.cameraMove]
                      .filter(Boolean)
                      .join(' · ')
                  }}
                  · {{ selectedShot.durationSec }}s
                </span>
                <span class="spacer" />
                <button
                  type="button"
                  class="ghost-btn compact-btn"
                  :title="t('graph.inspector.film.openShotPrevizHint')"
                  @click="openInDirectorPreviz({ shotId: selectedShot.id })"
                >
                  🧊 {{ t('graph.inspector.film.openShotPreviz') }}
                </button>
              </div>

              <!-- 单镜角色与场景参考图绑定展示 -->
              <div
                v-if="
                  shotBindingItems(selectedShot).length ||
                  prevSameSceneShot(selectedShot) ||
                  shotRawPrevizKeyframe(selectedShot) ||
                  shotRawPrevizVideo(selectedShot)
                "
                class="shot-binding-panel"
              >
                <div class="binding-chips">
                  <div
                    v-for="item in shotBindingItems(selectedShot)"
                    :key="`${item.kind}:${item.name}`"
                    class="binding-chip"
                    :class="[item.kind, { ready: item.refIndex > 0 }]"
                  >
                    <img
                      v-if="item.thumbUrl"
                      :src="item.thumbUrl"
                      :alt="item.name"
                      class="binding-thumb"
                      @click.stop="previewMedia(item.thumbUrl, item.name)"
                    />
                    <span class="badge">{{ t(`graph.inspector.film.kind.${item.kind}`) }}</span>
                    <strong class="binding-name">{{ item.name }}</strong>
                    <span v-if="item.refIndex > 0" class="ref-badge ready">
                      {{ t('graph.inspector.film.refSheetReady', { n: item.refIndex }) }}
                    </span>
                    <span v-else class="ref-badge pending">
                      {{ t('graph.inspector.film.refSheetMissing') }}
                    </span>
                  </div>
                  <div
                    v-if="prevSameSceneShot(selectedShot)"
                    class="binding-chip continuity"
                    :class="{ ready: !!shotKeyframeThumbUrl(prevSameSceneShot(selectedShot)!) }"
                    :title="
                      t('graph.inspector.film.continuityHint', {
                        id: prevSameSceneShot(selectedShot)!.id
                      })
                    "
                  >
                    <img
                      v-if="shotKeyframeThumbUrl(prevSameSceneShot(selectedShot)!)"
                      :src="shotKeyframeThumbUrl(prevSameSceneShot(selectedShot)!)"
                      :alt="prevSameSceneShot(selectedShot)!.id"
                      class="binding-thumb"
                      @click.stop="
                        previewMedia(
                          shotKeyframeThumbUrl(prevSameSceneShot(selectedShot)!),
                          prevSameSceneShot(selectedShot)!.id
                        )
                      "
                    />
                    <span class="badge">🔗</span>
                    <strong class="binding-name">
                      {{
                        t('graph.inspector.film.continuityFrom', {
                          id: prevSameSceneShot(selectedShot)!.id
                        })
                      }}
                    </strong>
                    <span v-if="prevShotKeyframeRefIndex(selectedShot) > 0" class="ref-badge ready">
                      {{
                        t('graph.inspector.film.refSheetReady', {
                          n: prevShotKeyframeRefIndex(selectedShot)
                        })
                      }}
                    </span>
                  </div>
                  <div
                    v-if="shotRawPrevizKeyframe(selectedShot)"
                    class="binding-chip previz ready"
                    :title="t('graph.inspector.film.previzRefHint')"
                  >
                    <img
                      v-if="shotPrevizThumbUrl(selectedShot)"
                      :src="shotPrevizThumbUrl(selectedShot)"
                      :alt="selectedShot.id"
                      class="binding-thumb"
                      @click.stop="
                        previewMedia(shotPrevizThumbUrl(selectedShot), `${selectedShot.id} Previz`)
                      "
                    />
                    <span class="badge">🧊</span>
                    <strong class="binding-name">
                      {{ t('graph.inspector.film.previzRefLabel') }}
                    </strong>
                    <span v-if="shotPrevizRefIndex(selectedShot, true) > 0" class="ref-badge ready">
                      {{
                        t('graph.inspector.film.refSheetReady', {
                          n: shotPrevizRefIndex(selectedShot, true)
                        })
                      }}
                    </span>
                  </div>
                  <div
                    v-if="shotRawPrevizVideo(selectedShot)"
                    class="binding-chip previz"
                    :class="{ ready: params.filmRenderPrevizVideoRef !== false }"
                    :title="t('graph.inspector.film.previzVideoRefHint')"
                    @click.stop="
                      previewVideoMedia(
                        shotPrevizVideoUrl(selectedShot),
                        `${selectedShot.id} 3D Previz Video`
                      )
                    "
                  >
                    <span class="badge">🎬</span>
                    <strong class="binding-name">
                      {{ t('graph.inspector.film.previzVideoRefLabel') }}
                    </strong>
                    <span v-if="params.filmRenderPrevizVideoRef !== false" class="ref-badge ready"
                      >@2</span
                    >
                  </div>
                </div>
              </div>

              <label>
                {{ t('graph.inspector.film.field.action') }}
                <textarea rows="2" :value="selectedShot.action" readonly />
              </label>
              <label>
                {{ t('graph.inspector.film.field.imagePrompt') }}
                <textarea rows="4" :value="composedSelectedImagePrompt" readonly />
              </label>
              <label>
                {{ t('graph.inspector.film.field.videoPrompt') }}
                <textarea rows="3" :value="composedSelectedVideoPrompt" readonly />
              </label>
            </article>
          </section>
          <div v-else class="empty-panel">
            <strong class="empty-title">
              {{ activeTabLabel }} · #{{ params.filmShotRef || '1' }}
            </strong>
            <span>{{ t('graph.inspector.film.emptyShot') }}</span>
            <span class="empty-sub">{{ t('graph.inspector.film.hint.shot') }}</span>
          </div>

          <section v-if="selectedShot" class="output-section">
            <h3>{{ t('graph.inspector.outputPreview') }}</h3>
            <GraphNodeOutputPreview v-if="hostId" :node="node" :host-id="hostId" />
          </section>
        </template>

        <!-- ④ 批量拍摄：镜头拍摄监控卡片 + 关键帧与视频画廊 -->
        <template v-else-if="kind === 'render'">
          <section v-if="effectiveStoryboard?.shots.length" class="shots-section">
            <div class="section-head">
              <h3>
                {{ t('graph.inspector.film.shots', { n: effectiveStoryboard.shots.length }) }}
              </h3>
              <div class="batch-actions">
                <button
                  type="button"
                  class="ghost-btn previz-stage-btn"
                  :disabled="previzOpeningKey !== null"
                  :title="t('graph.inspector.film.openDirectorPrevizHint')"
                  @click="openInDirectorPreviz()"
                >
                  {{ previzOpeningKey === '__all__' ? '⏳' : '🧊' }}
                  {{ t('graph.inspector.film.openDirectorPreviz') }}
                </button>
                <button type="button" class="ghost-btn" @click="toggleAllRenderPrompts">
                  {{
                    allRenderPromptsExpanded
                      ? t('graph.inspector.film.collapseAllPrompts')
                      : t('graph.inspector.film.expandAllPrompts')
                  }}
                </button>
              </div>
            </div>
            <div class="render-grid">
              <article
                v-for="(shot, idx) in effectiveStoryboard.shots"
                :key="shot.id"
                class="render-card"
                :class="{
                  fail: renderCache[shot.id]?.qc?.pass === false || !!renderCache[shot.id]?.error
                }"
              >
                <div class="shot-card-head">
                  <span class="shot-index">#{{ idx + 1 }}</span>
                  <span class="sid">{{ shot.id }}</span>
                  <span class="meta">
                    {{ [shot.shotSize, shot.cameraMove].filter(Boolean).join(' · ') }} ·
                    {{ shot.durationSec }}s
                  </span>
                  <span class="spacer" />
                  <span v-if="shotRawKeyframe(shot)" class="status-pill ok">
                    {{ t('graph.inspector.film.renderedKeyframe') }}
                  </span>
                  <span v-else class="status-pill">
                    {{ t('graph.inspector.film.pendingRender') }}
                  </span>
                  <span v-if="shotRawVideo(shot)" class="status-pill ok">
                    {{ t('graph.inspector.film.renderedVideo') }}
                  </span>
                  <span v-if="shotRawVoice(shot)" class="status-pill ok">
                    🎙️ {{ t('graph.inspector.film.renderedVoice') }}
                  </span>
                  <span
                    v-if="renderCache[shot.id]?.qc"
                    class="status-pill"
                    :class="renderCache[shot.id]?.qc?.pass ? 'ok' : 'fail'"
                  >
                    {{
                      renderCache[shot.id]?.qc?.pass
                        ? t('graph.inspector.film.qcPass')
                        : t('graph.inspector.film.qcFail')
                    }}
                  </span>
                  <button
                    type="button"
                    class="ghost-btn compact-btn"
                    :disabled="previzOpeningKey !== null"
                    :title="t('graph.inspector.film.openShotPrevizHint')"
                    @click="openInDirectorPreviz({ shotId: shot.id })"
                  >
                    {{ previzOpeningKey === shot.id ? '⏳' : '🧊' }}
                    {{ t('graph.inspector.film.openShotPreviz') }}
                  </button>
                  <button
                    type="button"
                    class="ghost-btn compact-btn"
                    :class="{ active: isRenderPromptExpanded(shot.id) }"
                    @click="toggleRenderPromptPreview(shot.id)"
                  >
                    {{
                      isRenderPromptExpanded(shot.id)
                        ? t('graph.inspector.film.hideFinalPrompt')
                        : t('graph.inspector.film.previewFinalPrompt')
                    }}
                  </button>
                  <button
                    type="button"
                    class="card-run-btn"
                    :disabled="runStatus === 'running' || blocked"
                    @click="runSingleRenderShot(shot.id)"
                  >
                    {{
                      runStatus === 'running' && runningTargetId === shot.id
                        ? t('graph.inspector.film.runningSingle')
                        : params.filmRenderMode === 'video' &&
                            shotRawKeyframe(shot) &&
                            !shotRawVideo(shot)
                          ? `▶ ${t('graph.inspector.film.runShotVideo')}`
                          : shotRawKeyframe(shot) || shotRawVideo(shot)
                            ? `↻ ${t('graph.inspector.film.rerunShotRender')}`
                            : `▶ ${t('graph.inspector.film.runShotRender')}`
                    }}
                  </button>
                </div>

                <!-- 视频 / 关键帧画面直出预览 -->
                <div v-if="shotVideoUrl(shot)" class="card-media-preview video">
                  <video
                    :src="shotVideoUrl(shot)"
                    :poster="shotKeyframeThumbUrl(shot) || undefined"
                    controls
                    preload="metadata"
                    playsinline
                    class="card-video-player"
                  />
                  <img
                    v-if="shotKeyframeThumbUrl(shot)"
                    :src="shotKeyframeThumbUrl(shot)"
                    :alt="shot.id"
                    class="card-keyframe-corner"
                    :title="t('graph.inspector.film.renderedKeyframe')"
                    @click.stop="previewMedia(shotKeyframeThumbUrl(shot), shot.id)"
                  />
                </div>
                <div
                  v-else-if="shotKeyframeThumbUrl(shot)"
                  class="card-media-preview"
                  @click="previewMedia(shotKeyframeThumbUrl(shot), shot.id)"
                >
                  <img :src="shotKeyframeThumbUrl(shot)" :alt="shot.id" />
                </div>

                <!-- 单镜角色配音音频直出预览 -->
                <audio
                  v-if="shotVoiceUrl(shot)"
                  :src="shotVoiceUrl(shot)"
                  controls
                  preload="metadata"
                  class="card-audio-player"
                />

                <!-- 本镜绑定的角色与场景设定参考（含 @1/@2 编号与缩略图） -->
                <div
                  v-if="
                    shotBindingItems(shot).length ||
                    (params.filmRenderContinuity !== false && prevSameSceneShot(shot)) ||
                    shotRawPrevizKeyframe(shot) ||
                    shotRawPrevizVideo(shot)
                  "
                  class="shot-binding-panel compact"
                >
                  <div class="binding-chips">
                    <div
                      v-for="item in shotBindingItems(shot)"
                      :key="`${item.kind}:${item.name}`"
                      class="binding-chip"
                      :class="[item.kind, { ready: item.refIndex > 0 }]"
                    >
                      <img
                        v-if="item.thumbUrl"
                        :src="item.thumbUrl"
                        :alt="item.name"
                        class="binding-thumb"
                        @click.stop="previewMedia(item.thumbUrl, item.name)"
                      />
                      <span class="badge">{{ t(`graph.inspector.film.kind.${item.kind}`) }}</span>
                      <strong class="binding-name">{{ item.name }}</strong>
                      <span v-if="item.refIndex > 0" class="ref-badge ready">
                        {{ t('graph.inspector.film.refSheetReady', { n: item.refIndex }) }}
                      </span>
                      <span v-else class="ref-badge pending">
                        {{ t('graph.inspector.film.refSheetMissing') }}
                      </span>
                    </div>
                    <div
                      v-if="params.filmRenderContinuity !== false && prevSameSceneShot(shot)"
                      class="binding-chip continuity"
                      :class="{ ready: !!shotKeyframeThumbUrl(prevSameSceneShot(shot)!) }"
                      :title="
                        t('graph.inspector.film.continuityHint', {
                          id: prevSameSceneShot(shot)!.id
                        })
                      "
                    >
                      <img
                        v-if="shotKeyframeThumbUrl(prevSameSceneShot(shot)!)"
                        :src="shotKeyframeThumbUrl(prevSameSceneShot(shot)!)"
                        :alt="prevSameSceneShot(shot)!.id"
                        class="binding-thumb"
                        @click.stop="
                          previewMedia(
                            shotKeyframeThumbUrl(prevSameSceneShot(shot)!),
                            prevSameSceneShot(shot)!.id
                          )
                        "
                      />
                      <span class="badge">🔗</span>
                      <strong class="binding-name">
                        {{
                          t('graph.inspector.film.continuityFrom', {
                            id: prevSameSceneShot(shot)!.id
                          })
                        }}
                      </strong>
                      <span v-if="prevShotKeyframeRefIndex(shot) > 0" class="ref-badge ready">
                        {{
                          t('graph.inspector.film.refSheetReady', {
                            n: prevShotKeyframeRefIndex(shot)
                          })
                        }}
                      </span>
                    </div>
                    <div
                      v-if="shotRawPrevizKeyframe(shot)"
                      class="binding-chip previz ready"
                      :title="t('graph.inspector.film.previzRefHint')"
                    >
                      <img
                        v-if="shotPrevizThumbUrl(shot)"
                        :src="shotPrevizThumbUrl(shot)"
                        :alt="shot.id"
                        class="binding-thumb"
                        @click.stop="previewMedia(shotPrevizThumbUrl(shot), `${shot.id} Previz`)"
                      />
                      <span class="badge">🧊</span>
                      <strong class="binding-name">
                        {{ t('graph.inspector.film.previzRefLabel') }}
                      </strong>
                      <span
                        v-if="shotPrevizRefIndex(shot, params.filmRenderContinuity !== false) > 0"
                        class="ref-badge ready"
                      >
                        {{
                          t('graph.inspector.film.refSheetReady', {
                            n: shotPrevizRefIndex(shot, params.filmRenderContinuity !== false)
                          })
                        }}
                      </span>
                      <button
                        v-if="storyboard?.shots?.length"
                        type="button"
                        class="binding-remove"
                        @click="clearShotPreviz(shot.id)"
                      >
                        ×
                      </button>
                    </div>
                    <div
                      v-if="shotRawPrevizVideo(shot)"
                      class="binding-chip previz"
                      :class="{ ready: params.filmRenderPrevizVideoRef !== false }"
                      :title="t('graph.inspector.film.previzVideoRefHint')"
                      @click.stop="
                        previewVideoMedia(shotPrevizVideoUrl(shot), `${shot.id} 3D Previz Video`)
                      "
                    >
                      <span class="badge">🎬</span>
                      <strong class="binding-name">
                        {{ t('graph.inspector.film.previzVideoRefLabel') }}
                      </strong>
                      <span v-if="params.filmRenderPrevizVideoRef !== false" class="ref-badge ready"
                        >@2</span
                      >
                    </div>
                  </div>
                </div>

                <p class="render-action">{{ shot.action || shot.imagePrompt }}</p>

                <!-- 最终提示词预览面板 -->
                <div v-if="isRenderPromptExpanded(shot.id)" class="render-prompt-preview">
                  <label>
                    {{ t('graph.inspector.film.finalImagePrompt') }}
                    <textarea rows="5" :value="composeRenderFinalImagePrompt(shot)" readonly />
                  </label>
                  <label>
                    {{ t('graph.inspector.film.finalVideoPrompt') }}
                    <textarea rows="3" :value="composeRenderFinalVideoPrompt(shot)" readonly />
                  </label>
                </div>

                <p
                  v-if="
                    renderCache[shot.id]?.qc?.pass === false && renderCache[shot.id]?.qc?.issues
                  "
                  class="review-note"
                >
                  ⚠ {{ renderCache[shot.id]?.qc?.issues }}
                </p>
                <p v-if="renderCache[shot.id]?.error" class="review-note">
                  ⚠ {{ renderCache[shot.id]?.error }}
                </p>
              </article>
            </div>
          </section>
          <div v-else-if="!hasRenderOutputs" class="empty-panel">
            <strong class="empty-title">
              {{ activeTabLabel }} ·
              {{ t(`graph.inspector.film.mode.${params.filmRenderMode ?? 'keyframe'}`) }}
            </strong>
            <span>{{ t('graph.inspector.film.emptyRender') }}</span>
            <span class="empty-sub">{{ t('graph.inspector.film.hint.render') }}</span>
          </div>

          <section v-if="hasRenderOutputs" class="output-section">
            <h3>{{ t('graph.inspector.outputPreview') }}</h3>
            <GraphNodeOutputPreview
              v-if="hostId"
              :node="node"
              :host-id="hostId"
              port-id="out-images"
            />
            <GraphNodeOutputPreview
              v-if="hostId"
              :node="node"
              :host-id="hostId"
              port-id="out-videos"
            />
            <GraphNodeOutputPreview
              v-if="hostId"
              :node="node"
              :host-id="hostId"
              port-id="out-voices"
            />
          </section>
        </template>

        <!-- ⑤ 成片发布包（阶段五）：单集完整成片 (.mp4) + 双规格封面提示词、片尾钩子卡、下集预告与平台元数据 -->
        <template v-else-if="kind === 'publish'">
          <section v-if="effectivePublishPack" class="manju-publish-panel">
            <!-- 单集完整成片 (.mp4) 一键合成与预览卡片 -->
            <div class="manju-composed-video-card">
              <div class="section-head">
                <div class="manju-audit-title-row">
                  <h3>{{ t('graph.inspector.film.publishPanel.composedVideoTitle') }}</h3>
                  <span v-if="composedShotCount > 0" class="badge accent">
                    {{
                      t('graph.inspector.film.publishPanel.composedVideoStats', {
                        shots: composedShotCount,
                        voices: composedVoiceCount
                      })
                    }}
                  </span>
                </div>
                <button
                  type="button"
                  class="full-pipeline-btn"
                  :disabled="runStatus === 'running' || blocked"
                  @click="runComposeEpisodeVideo"
                >
                  {{
                    runStatus === 'running'
                      ? t('graph.inspector.film.publishPanel.composingVideoBtn')
                      : t('graph.inspector.film.publishPanel.composeVideoBtn')
                  }}
                </button>
              </div>
              <div v-if="composedEpisodeVideoUrl" class="composed-video-player-wrap">
                <video
                  :src="composedEpisodeVideoUrl"
                  controls
                  preload="metadata"
                  playsinline
                  class="composed-episode-video"
                />
              </div>
              <p v-else class="hint">
                {{ t('graph.inspector.film.publishPanel.composedVideoEmptyHint') }}
              </p>
            </div>

            <div class="section-head">
              <div>
                <h3>{{ t('graph.inspector.film.publishPanel.title') }}</h3>
                <p class="hint">{{ t('graph.inspector.film.publishPanel.subtitle') }}</p>
              </div>
              <button
                type="button"
                class="ghost-btn previz-stage-btn"
                @click="copyPublishPackMarkdown"
              >
                📋
                {{
                  publishCopied
                    ? t('graph.inspector.film.publishPanel.copied')
                    : t('graph.inspector.film.publishPanel.copyAll')
                }}
              </button>
            </div>

            <div class="manju-publish-grid">
              <div class="manju-publish-card">
                <label>
                  {{ t('graph.inspector.film.publishPanel.coverVertical') }}
                  <textarea
                    rows="3"
                    :value="effectivePublishPack.verticalCoverPrompt"
                    @change="patchPublishField('verticalCoverPrompt', $event)"
                  />
                </label>
              </div>
              <div class="manju-publish-card">
                <label>
                  {{ t('graph.inspector.film.publishPanel.coverHorizontal') }}
                  <textarea
                    rows="3"
                    :value="effectivePublishPack.horizontalCoverPrompt"
                    @change="patchPublishField('horizontalCoverPrompt', $event)"
                  />
                </label>
              </div>
              <div class="manju-publish-card">
                <label>
                  {{ t('graph.inspector.film.publishPanel.endCardText') }}
                  <input
                    type="text"
                    :value="effectivePublishPack.endCardPlan"
                    @change="patchPublishField('endCardPlan', $event)"
                  />
                </label>
                <label>
                  {{ t('graph.inspector.film.publishPanel.nextTeaser') }}
                  <textarea
                    rows="2"
                    :value="effectivePublishPack.nextEpisodeTeaser"
                    @change="patchPublishField('nextEpisodeTeaser', $event)"
                  />
                </label>
              </div>
              <div class="manju-publish-card">
                <label>
                  {{ t('graph.inspector.film.publishPanel.titles') }}
                  <input
                    v-for="(titleItem, tIdx) in effectivePublishPack.titles"
                    :key="tIdx"
                    type="text"
                    :value="titleItem"
                    @change="patchPublishTitle(tIdx, $event)"
                  />
                </label>
              </div>
              <div class="manju-publish-card">
                <label>
                  {{ t('graph.inspector.film.publishPanel.synopsis') }}
                  <textarea
                    rows="2"
                    :value="effectivePublishPack.synopsis"
                    @change="patchPublishField('synopsis', $event)"
                  />
                </label>
                <label>
                  {{ t('graph.inspector.film.publishPanel.hashtags') }}
                  <input
                    type="text"
                    :value="effectivePublishPack.hashtags.join(' ')"
                    @change="patchPublishHashtags($event)"
                  />
                </label>
              </div>
              <div class="manju-publish-card">
                <label>
                  {{ t('graph.inspector.film.publishPanel.pinnedComment') }}
                  <textarea
                    rows="2"
                    :value="effectivePublishPack.pinnedComment"
                    @change="patchPublishField('pinnedComment', $event)"
                  />
                </label>
                <label>
                  {{ t('graph.inspector.film.publishPanel.compliance') }}
                  <input
                    type="text"
                    :value="effectivePublishPack.complianceNotice"
                    @change="patchPublishField('complianceNotice', $event)"
                  />
                </label>
              </div>
            </div>
          </section>
          <div v-else class="empty-panel">
            <strong class="empty-title">{{ activeTabLabel }}</strong>
            <span>{{ t('graph.inspector.film.publishPanel.empty') }}</span>
            <span class="empty-sub">{{ t('graph.inspector.film.hint.publish') }}</span>
          </div>
        </template>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, ref, watch } from 'vue'
import {
  FILM_TTS_VOICE_PRESETS,
  buildDefaultVideoBeatsForShot,
  composeFilmShotImagePrompt,
  composeFilmShotVideoPrompt,
  deriveFilmCast,
  deriveManjuPublishPack,
  filmBaseEntityName,
  filmCastEntryImage,
  filmNameKey,
  filmVideoParamsToNodePatch,
  findPrevSameSceneShot,
  imageGenerateParamsToNodePatch,
  isDirectorProcessingNode,
  isFilmNodeTypeId,
  isFilmShotLocked,
  matchFilmCastForShot,
  mergeFilmCasts,
  parseFilmCast,
  parseFilmCastKinds,
  parseFilmRenderCache,
  parseFilmStoryboard,
  readFilmVideoParamsFromNode,
  readImageGenerateParamsFromNode,
  resolveFilmDirectorStage,
  resolveFilmShotPrevizCinematography,
  resolveFilmShotPrevizMediaFromStage,
  resolveManjuGenre,
  resolveNodeType,
  runManjuContinuityAudit,
  selectFilmShot,
  stringifyFilmCast,
  stringifyFilmStoryboard,
  type FilmCast,
  type FilmEntity,
  type FilmEntityKind,
  type FilmShot,
  type FilmStoryboard,
  type FilmVideoBeat,
  type GraphNode,
  type GraphNodeParams,
  type GraphNodeRunStatus,
  type ImageGenerateParams,
  type ManjuGenreSpec,
  type ManjuPublishPack,
  type VideoGenerateParams
} from '@shared/graph'
import GraphNodeRunControl from '../GraphNodeRunControl.vue'
import GraphNodeOutputPreview from '../GraphNodeOutputPreview.vue'
import InstructionModelSelect from '../InstructionModelSelect.vue'
import ImageGenerateParamsSelect from '../ImageGenerateParamsSelect.vue'
import VideoGenerateParamsSelect from '../VideoGenerateParamsSelect.vue'
import WorkspaceItemIcon from '../WorkspaceItemIcon.vue'
import { useStudioI18n } from '../../composables/useStudioI18n'
import { useGraphNodeRun } from '../../composables/useGraphNodeRun'
import { persistAssetRecord, useAssetRecord } from '../../composables/useAssetRecord'
import {
  canReuseCompiledStoryboardStage,
  compileStoryboardToDirectorStageWithLlm,
  markCompiledStoryboardStage
} from '../../features/director/directorStoryboardPreviz'
import {
  patchGenParamsWithNodeStage,
  resolveDirectorStageForNode
} from '../../features/director/directorStageBinding'
import { editorDiveKey } from '../../features/graph/model/editorDive'
import { graphEditorHosts } from '../../features/graph/model/graphEditorHosts'
import { openFullImagePreview } from '../../features/media/openFullImagePreview'
import {
  invalidateGenerateModelSettingsCache,
  loadGenerateModelOptions,
  parseModelKey,
  preferredModelKey,
  type GenerateModelModality,
  type GenerateModelOption
} from '../../features/graph/model/generateModelOptions'

type FilmKind = 'breakdown' | 'review' | 'cast' | 'shot' | 'render' | 'publish'
type WorkbenchStage = 'breakdown' | 'review' | 'cast' | 'render' | 'publish'
const WORKBENCH_STAGES: WorkbenchStage[] = ['breakdown', 'review', 'cast', 'render', 'publish']

const ASPECT_RATIOS = ['16:9', '9:16', '2.39:1', '4:3', '1:1', '3:4']
const SHOT_DURATION_PRESETS = [0, 4, 8, 10, 15] as const
const CAST_KINDS: FilmEntityKind[] = ['character', 'location', 'prop', 'vfx', 'style']
const RENDER_MODES = ['keyframe', 'video'] as const

const props = defineProps<{
  frameKey: string
  hostId: string
  nodeId: string
}>()

const { t, locale, graphTypeLabel } = useStudioI18n()
const isEnLocale = computed(() => String(locale.value).toLowerCase().startsWith('en'))
const diveCtx = inject(editorDiveKey, null)
const hostAssetId = computed(() =>
  props.hostId.startsWith('asset:')
    ? props.hostId.slice('asset:'.length).trim()
    : props.hostId.trim()
)
const { asset: hostAsset } = useAssetRecord(hostAssetId.value)

const activeNodeId = ref(props.nodeId)
watch(
  () => props.nodeId,
  (nextId) => {
    if (nextId) activeNodeId.value = nextId
  }
)

const node = computed((): GraphNode | null => {
  void graphEditorHosts.revision.value
  const current = graphEditorHosts.getNode(props.hostId, activeNodeId.value)
  return current && isFilmNodeTypeId(current.typeId) ? current : null
})

const isWorkbenchNode = computed(() => node.value?.typeId === 'film.workbench')
const params = computed((): GraphNodeParams => {
  void graphEditorHosts.revision.value
  return node.value?.params ?? {}
})

const activeTabLabel = computed(() => {
  if (isWorkbenchNode.value) return t(`graph.inspector.film.stageTabs.${kind.value}`)
  return typeLabel.value
})

const kind = computed((): FilmKind => {
  if (isWorkbenchNode.value) {
    const stage = params.value.filmWorkbenchStage
    if (
      stage === 'breakdown' ||
      stage === 'review' ||
      stage === 'cast' ||
      stage === 'render' ||
      stage === 'publish'
    ) {
      return stage
    }
    return 'breakdown'
  }
  return (node.value?.typeId?.slice('film.'.length) ?? 'breakdown') as FilmKind
})

function switchWorkbenchStage(stage: WorkbenchStage): void {
  patchParams({ filmWorkbenchStage: stage })
  if (node.value) void loadModels(node.value)
}

function stageBadge(stage: WorkbenchStage): string {
  if (stage === 'breakdown') {
    const n = effectiveStoryboard.value?.shots?.length ?? 0
    return n > 0 ? String(n) : ''
  }
  if (stage === 'review') {
    return (
      params.value.filmReviewVerdict ||
      effectiveStoryboard.value?.review?.verdict ||
      (liveContinuityAudit.value ? (liveContinuityAudit.value.passed ? 'PASS' : 'FAIL') : '')
    )
  }
  if (stage === 'cast') {
    const total = castEntries.value.length
    if (!total) return ''
    const ready = castEntries.value.filter(
      (e) => !!(e.imageRelativePath?.trim() || e.imageUrl?.trim())
    ).length
    return `${ready}/${total}`
  }
  if (stage === 'publish') {
    return effectiveStoryboard.value?.publishPack ? '✓' : ''
  }
  const shots = effectiveStoryboard.value?.shots ?? []
  if (!shots.length) return ''
  const ready = shots.filter((s) => !!shotRawKeyframe(s)).length
  return `${ready}/${shots.length}`
}

const typeLabel = computed(() => (node.value?.typeId ? graphTypeLabel(node.value.typeId) : ''))
const nodeIcon = computed(() => {
  const current = node.value
  if (!current) return '🎬'
  return resolveNodeType(current)?.icon?.trim() || '🎬'
})
const { hasInPort, runStatus, isGraphRunning, blocked, toggleRun } = useGraphNodeRun(
  node,
  () => props.hostId
)

const runningTargetId = ref('')
watch(runStatus, (status) => {
  if (status !== 'running') runningTargetId.value = ''
})

function patchParams(patch: Partial<GraphNodeParams>): void {
  const current = node.value
  if (!current || !props.hostId) return
  graphEditorHosts.updateNode(props.hostId, current.id, patch)
}

function inputValue(event: Event): string {
  return (event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value
}

function patchString(key: keyof GraphNodeParams, event: Event): void {
  patchParams({ [key]: inputValue(event).trim() } as Partial<GraphNodeParams>)
}

function patchNumber(key: keyof GraphNodeParams, event: Event, min: number, max: number): void {
  const n = Math.round(Number(inputValue(event)))
  const value = Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min
  patchParams({ [key]: value } as Partial<GraphNodeParams>)
}

function patchBool(key: keyof GraphNodeParams, event: Event): void {
  patchParams({ [key]: (event.target as HTMLInputElement).checked } as Partial<GraphNodeParams>)
}

const currentInstruction = computed((): string => {
  if (isWorkbenchNode.value) {
    if (kind.value === 'breakdown') return params.value.filmBreakdownInstruction ?? ''
    if (kind.value === 'review') return params.value.filmReviewInstruction ?? ''
    if (kind.value === 'cast') return params.value.filmCastInstruction ?? ''
  }
  return params.value.generateInstruction ?? ''
})

function patchCurrentInstruction(event: Event): void {
  if (isWorkbenchNode.value) {
    if (kind.value === 'breakdown') return patchString('filmBreakdownInstruction', event)
    if (kind.value === 'review') return patchString('filmReviewInstruction', event)
    if (kind.value === 'cast') return patchString('filmCastInstruction', event)
  }
  patchString('generateInstruction', event)
}

// ─── 显示名 ───
const displayName = ref('')
watch(
  node,
  (current) => {
    const custom = current?.title?.trim() || ''
    const def = current ? resolveNodeType(current) : undefined
    displayName.value = def?.defaultTitle && custom === def.defaultTitle ? '' : custom
  },
  { immediate: true }
)
function persistTitle(): void {
  const current = node.value
  if (!current || !props.hostId) return
  const def = resolveNodeType(current)
  const nextTitle = displayName.value.trim() || def?.defaultTitle || ''
  graphEditorHosts.updateNode(props.hostId, current.id, {}, nextTitle)
  graphEditorHosts.bumpRevision()
}

// ─── 模型加载与生成参数 ───
const primaryOptions = ref<GenerateModelOption[]>([])
const videoOptions = ref<GenerateModelOption[]>([])
const textOptions = ref<GenerateModelOption[]>([])
const primaryModelKey = ref('')
const videoModelKey = ref('')
const qcModelKey = ref('')
const loadedKey = ref('')
const imageGenerateParams = ref<ImageGenerateParams>(readImageGenerateParamsFromNode({}))
const videoGenerateParams = ref<VideoGenerateParams>(readFilmVideoParamsFromNode({}))

watch(
  params,
  (p) => {
    imageGenerateParams.value = readImageGenerateParamsFromNode(p)
    videoGenerateParams.value = readFilmVideoParamsFromNode(p)
  },
  { immediate: true }
)

function persistImageGenerateParams(): void {
  patchParams(imageGenerateParamsToNodePatch(imageGenerateParams.value))
}

function persistVideoGenerateParams(): void {
  const patch: Partial<GraphNodeParams> = {
    ...filmVideoParamsToNodePatch(videoGenerateParams.value)
  }
  const video = parseModelKey(videoModelKey.value)
  if (video?.model && !params.value.filmVideoModel?.trim()) {
    patch.filmVideoModel = video.model
    patch.filmVideoProviderInstanceId = video.providerInstanceId
  }
  patchParams(patch)
}

async function loadOptions(
  modality: GenerateModelModality,
  preferred: string
): Promise<{ options: GenerateModelOption[]; selectedKey: string }> {
  const { options, selectedKey } = await loadGenerateModelOptions(modality, preferred)
  return {
    options,
    selectedKey: preferred && options.some((o) => o.key === preferred) ? preferred : selectedKey
  }
}

async function loadModels(current: GraphNode): Promise<void> {
  invalidateGenerateModelSettingsCache()
  const p = current.params
  imageGenerateParams.value = readImageGenerateParamsFromNode(p)
  videoGenerateParams.value = readFilmVideoParamsFromNode(p)
  const isTextStage = kind.value === 'breakdown' || kind.value === 'review'
  const primaryModality: GenerateModelModality = isTextStage ? 'text' : 'image'
  const preferredPrimary =
    current.typeId === 'film.workbench' && isTextStage
      ? preferredModelKey(p.filmTextProviderInstanceId, p.filmTextModel)
      : preferredModelKey(p.generateProviderInstanceId, p.generateModel)
  const primary = await loadOptions(primaryModality, preferredPrimary)
  primaryOptions.value = primary.options
  primaryModelKey.value = primary.selectedKey
  if (kind.value === 'render' || current.typeId === 'film.workbench') {
    const video = await loadOptions(
      'video',
      preferredModelKey(p.filmVideoProviderInstanceId, p.filmVideoModel)
    )
    videoOptions.value = video.options
    videoModelKey.value = video.selectedKey
    const text = await loadOptions(
      'text',
      preferredModelKey(p.filmQcProviderInstanceId, p.filmQcModel)
    )
    textOptions.value = text.options
    qcModelKey.value = text.selectedKey
  }
}

function persistModel(which: 'primary' | 'video' | 'qc'): void {
  const key =
    which === 'primary'
      ? primaryModelKey.value
      : which === 'video'
        ? videoModelKey.value
        : qcModelKey.value
  const parsed = parseModelKey(key)
  const model = parsed?.model ?? ''
  const providerInstanceId = parsed?.providerInstanceId ?? ''
  if (which === 'primary') {
    if (isWorkbenchNode.value && (kind.value === 'breakdown' || kind.value === 'review')) {
      patchParams({ filmTextModel: model, filmTextProviderInstanceId: providerInstanceId })
    } else {
      patchParams({ generateModel: model, generateProviderInstanceId: providerInstanceId })
    }
  } else if (which === 'video') {
    patchParams({ filmVideoModel: model, filmVideoProviderInstanceId: providerInstanceId })
  } else {
    patchParams({ filmQcModel: model, filmQcProviderInstanceId: providerInstanceId })
  }
}

function syncSelectedModelsToParams(): void {
  const patch: Partial<GraphNodeParams> = {}
  const primary = parseModelKey(primaryModelKey.value)
  if (primary?.model) {
    if (isWorkbenchNode.value && (kind.value === 'breakdown' || kind.value === 'review')) {
      if (!params.value.filmTextModel?.trim()) {
        patch.filmTextModel = primary.model
        patch.filmTextProviderInstanceId = primary.providerInstanceId
      }
    } else if (!params.value.generateModel?.trim()) {
      patch.generateModel = primary.model
      patch.generateProviderInstanceId = primary.providerInstanceId
    }
  }
  if (kind.value === 'render' || isWorkbenchNode.value) {
    const video = parseModelKey(videoModelKey.value)
    if (video?.model && !params.value.filmVideoModel?.trim()) {
      patch.filmVideoModel = video.model
      patch.filmVideoProviderInstanceId = video.providerInstanceId
    }
    const qc = parseModelKey(qcModelKey.value)
    if (qc?.model && !params.value.filmQcModel?.trim()) {
      patch.filmQcModel = qc.model
      patch.filmQcProviderInstanceId = qc.providerInstanceId
    }
  }
  if (Object.keys(patch).length > 0) patchParams(patch)
}

function setRenderMode(mode: 'keyframe' | 'video'): void {
  const patch: Partial<GraphNodeParams> = { filmRenderMode: mode }
  if (mode === 'video') {
    const video = parseModelKey(videoModelKey.value)
    if (video?.model && !params.value.filmVideoModel?.trim()) {
      patch.filmVideoModel = video.model
      patch.filmVideoProviderInstanceId = video.providerInstanceId
    }
  }
  patchParams(patch)
}

function handleToggleRun(): void {
  if (runStatus.value !== 'running') {
    syncSelectedModelsToParams()
    if (
      isWorkbenchNode.value &&
      (kind.value === 'breakdown' ||
        kind.value === 'review' ||
        kind.value === 'cast' ||
        kind.value === 'render' ||
        kind.value === 'publish')
    ) {
      patchParams({ filmWorkbenchRunMode: kind.value })
    }
  }
  toggleRun()
}

function handleRunFullPipeline(): void {
  if (runStatus.value === 'running' || blocked.value) return
  syncSelectedModelsToParams()
  patchParams({ filmWorkbenchRunMode: 'all' })
  toggleRun()
}

watch(
  node,
  (current) => {
    if (!current) return
    const p = current.params
    const key = `${props.hostId}:${current.id}:${p.filmWorkbenchStage ?? ''}:${p.generateModel ?? ''}:${p.filmTextModel ?? ''}:${p.filmVideoModel ?? ''}:${p.filmQcModel ?? ''}`
    if (key === loadedKey.value) return
    loadedKey.value = key
    void loadModels(current)
  },
  { immediate: true }
)

// ─── AI 漫剧 21 题材 Skill 决策树与实时工业审计（自上游剧本自动同步） ───
function findUpstreamScriptText(startNodeId: string): { text: string; genreId: string } {
  const visited = new Set<string>()
  const queue = [startNodeId]
  let foundText = ''
  let foundGenreId = ''
  while (queue.length) {
    const cur = queue.shift()!
    if (visited.has(cur)) continue
    visited.add(cur)
    const edges = graphEditorHosts.listIncomingEdges(props.hostId, cur)
    for (const edge of edges) {
      const src = graphEditorHosts.getNode(props.hostId, edge.sourceNodeId)
      if (!src) continue
      if (!foundGenreId && src.params.filmGenre?.trim() && src.params.filmGenre.trim() !== 'auto') {
        foundGenreId = src.params.filmGenre.trim()
      }
      if (!foundText) {
        const text = (src.params.text ?? src.params.generateInstruction ?? '').trim()
        if (text && text !== '…') foundText = text
      }
      if (foundText && foundGenreId) return { text: foundText, genreId: foundGenreId }
      queue.push(src.id)
    }
  }
  return { text: foundText, genreId: foundGenreId }
}

const activeManjuGenreSpec = computed((): ManjuGenreSpec | null => {
  void graphEditorHosts.revision.value
  const sb = displayStoryboard.value ?? effectiveStoryboard.value
  const upstream = node.value ? findUpstreamScriptText(node.value.id) : { text: '', genreId: '' }
  const scriptExplicitMatch = upstream.text.match(/\b([a-z]{3,16}-manju)\b/i)
  const explicitId =
    upstream.genreId ||
    (scriptExplicitMatch?.[1] ? scriptExplicitMatch[1].toLowerCase() : '') ||
    sb?.genreId ||
    params.value.filmGenre
  const hint =
    explicitId ||
    `${upstream.text} ${sb?.title || ''} ${sb?.logline || ''} ${params.value.filmStyle || ''}`
  return resolveManjuGenre(explicitId, hint)
})

const genreDefaultsApplied = ref(false)
let genreDefaultsTimer: ReturnType<typeof setTimeout> | null = null

function applyManjuGenreDefaults(): void {
  const spec = activeManjuGenreSpec.value
  if (!spec) return
  const midShots = Math.round((spec.shotCountRange[0] + spec.shotCountRange[1]) / 2)
  const midDur = Math.round((spec.shotDurationRangeSec[0] + spec.shotDurationRangeSec[1]) / 2)
  const styleText = isEnLocale.value ? spec.visualStyleEn : spec.visualStyleZh
  const nextPatch: Partial<GraphNodeParams> = {
    filmGenre: spec.id,
    filmAspectRatio: '9:16',
    generateAspectRatio: '9:16',
    filmVideoAspectRatio: '9:16',
    filmTargetShots: midShots,
    filmShotDurationSec: midDur,
    filmStyle: styleText
  }
  const sb = storyboard.value ?? effectiveStoryboard.value
  if (sb) {
    const nextSb: FilmStoryboard = {
      ...sb,
      genreId: spec.id,
      aspectRatio: '9:16',
      style: styleText,
      bible: {
        ...sb.bible,
        colorScheme: sb.bible?.colorScheme || styleText,
        episodeProgressRule: sb.bible?.episodeProgressRule || spec.episodeProgressTemplateZh
      },
      episodeMeta: {
        ...sb.episodeMeta,
        episodeProgress: sb.episodeMeta?.episodeProgress || spec.episodeProgressTemplateZh
      }
    }
    nextSb.continuityAudit = runManjuContinuityAudit(nextSb, graphCast.value, spec)
    nextSb.publishPack = deriveManjuPublishPack(nextSb, String(locale.value))
    nextPatch.filmStoryboard = stringifyFilmStoryboard(nextSb)
  }
  const currentCast = cast.value ?? effectiveCast.value
  if (currentCast) {
    nextPatch.filmCast = stringifyFilmCast({
      ...currentCast,
      style: styleText
    })
  }
  imageGenerateParams.value = { ...imageGenerateParams.value, aspectRatio: '9:16' }
  videoGenerateParams.value = { ...videoGenerateParams.value, aspectRatio: '9:16' }
  patchParams(nextPatch)
  genreDefaultsApplied.value = true
  if (genreDefaultsTimer) clearTimeout(genreDefaultsTimer)
  genreDefaultsTimer = setTimeout(() => {
    genreDefaultsApplied.value = false
  }, 2200)
}

const liveContinuityAudit = computed(() => {
  const sb = displayStoryboard.value ?? effectiveStoryboard.value
  if (!sb || !sb.shots.length) return null
  return (
    sb.continuityAudit ?? runManjuContinuityAudit(sb, graphCast.value, activeManjuGenreSpec.value)
  )
})

const effectivePublishPack = computed((): ManjuPublishPack | null => {
  const sb = effectiveStoryboard.value
  if (!sb || !sb.shots.length) return null
  return sb.publishPack ?? deriveManjuPublishPack(sb, String(locale.value))
})

function writePublishPack(mutate: (pack: ManjuPublishPack) => ManjuPublishPack): void {
  const doc = storyboard.value ?? effectiveStoryboard.value
  const currentPack = effectivePublishPack.value
  if (!doc || !currentPack) return
  patchParams({
    filmStoryboard: stringifyFilmStoryboard({
      ...doc,
      publishPack: mutate(currentPack)
    })
  })
}

function patchPublishField(
  field:
    | 'verticalCoverPrompt'
    | 'horizontalCoverPrompt'
    | 'endCardPlan'
    | 'nextEpisodeTeaser'
    | 'synopsis'
    | 'pinnedComment'
    | 'complianceNotice',
  event: Event
): void {
  const value = inputValue(event).trim()
  writePublishPack((pack) => ({ ...pack, [field]: value }))
}

function patchPublishTitle(idx: number, event: Event): void {
  const value = inputValue(event).trim()
  writePublishPack((pack) => {
    const nextTitles = [...pack.titles]
    nextTitles[idx] = value
    return { ...pack, titles: nextTitles }
  })
}

function patchPublishHashtags(event: Event): void {
  const tags = inputValue(event)
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
  writePublishPack((pack) => ({ ...pack, hashtags: tags }))
}

const publishCopied = ref(false)
async function copyPublishPackMarkdown(): Promise<void> {
  const pack = effectivePublishPack.value
  if (!pack) return
  const md = [
    `# ${t('graph.inspector.film.publishPanel.title')}`,
    `## 1. ${t('graph.inspector.film.publishPanel.coverVertical')}`,
    pack.verticalCoverPrompt,
    `## 2. ${t('graph.inspector.film.publishPanel.coverHorizontal')}`,
    pack.horizontalCoverPrompt,
    `## 3. ${t('graph.inspector.film.publishPanel.endCardText')}`,
    pack.endCardPlan,
    `## 4. ${t('graph.inspector.film.publishPanel.nextTeaser')}`,
    pack.nextEpisodeTeaser,
    `## 5. ${t('graph.inspector.film.publishPanel.titles')}`,
    ...pack.titles.map((item, i) => `${i + 1}. ${item}`),
    `## 6. ${t('graph.inspector.film.publishPanel.synopsis')}`,
    pack.synopsis,
    `## 7. ${t('graph.inspector.film.publishPanel.hashtags')}`,
    pack.hashtags.join(' '),
    `## 8. ${t('graph.inspector.film.publishPanel.pinnedComment')}`,
    pack.pinnedComment,
    `## 9. ${t('graph.inspector.film.publishPanel.compliance')}`,
    pack.complianceNotice
  ].join('\n\n')
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(md)
      publishCopied.value = true
      setTimeout(() => {
        publishCopied.value = false
      }, 2000)
    }
  } catch {
    /* ignore */
  }
}

const expandedShotAbIds = ref<Record<string, boolean>>({})
function isShotAbExpanded(shotId: string): boolean {
  return !!expandedShotAbIds.value[shotId]
}
function toggleShotAbDrawer(shotId: string): void {
  expandedShotAbIds.value = {
    ...expandedShotAbIds.value,
    [shotId]: !expandedShotAbIds.value[shotId]
  }
}
function isShotLipSync(shot: FilmShot): boolean {
  return Boolean(
    shot.isLipSyncShot ||
    shot.dialogue.some((d) => (d.mode ?? 'spoken') === 'spoken' && d.line.trim().length > 0)
  )
}
function shotVideoBeats(shot: FilmShot): FilmVideoBeat[] {
  return shot.videoBeats?.length ? shot.videoBeats : buildDefaultVideoBeatsForShot(shot)
}
function patchShotManjuField(
  id: string,
  field: 'focalLength' | 'subjectPosition' | 'blockingAndPose' | 'expression' | 'lighting',
  event: Event
): void {
  const value = inputValue(event).trim()
  writeStoryboard((shots) =>
    shots.map((shot) =>
      shot.id === id ? { ...shot, [field]: value, locked: true, status: 'approved' as const } : shot
    )
  )
}

// ─── 上游分镜与设定解析（供 review / shot / render 实时回退预览） ───
function findUpstreamStoryboard(startNodeId: string): FilmStoryboard | null {
  const visited = new Set<string>()
  const queue = [startNodeId]
  while (queue.length) {
    const cur = queue.shift()!
    if (visited.has(cur)) continue
    visited.add(cur)
    const edges = graphEditorHosts.listIncomingEdges(props.hostId, cur)
    for (const edge of edges) {
      const src = graphEditorHosts.getNode(props.hostId, edge.sourceNodeId)
      if (!src) continue
      const parsed = parseFilmStoryboard(src.params.filmStoryboard ?? '')
      if (parsed?.shots?.length) return parsed
      queue.push(src.id)
    }
  }
  return null
}

function findUpstreamCast(startNodeId: string): FilmCast | null {
  const visited = new Set<string>()
  const queue = [startNodeId]
  const found: FilmCast[] = []
  while (queue.length) {
    const cur = queue.shift()!
    if (visited.has(cur)) continue
    visited.add(cur)
    const edges = graphEditorHosts.listIncomingEdges(props.hostId, cur)
    for (const edge of edges) {
      const src = graphEditorHosts.getNode(props.hostId, edge.sourceNodeId)
      if (!src) continue
      const parsed = parseFilmCast(src.params.filmCast ?? '')
      if (parsed?.entries?.length) found.push(parsed)
      queue.push(src.id)
    }
  }
  const direct = mergeFilmCasts(...found.reverse())
  if (direct?.entries?.length) return direct
  if (params.value.filmUseSharedCast === false) return null
  const sharedCasts: FilmCast[] = []
  for (const item of pipelineNodes.value) {
    if (item.id === startNodeId) continue
    if (item.typeId !== 'film.workbench' && item.typeId !== 'film.cast') continue
    const parsed = parseFilmCast(item.params?.filmCast ?? '')
    if (!parsed?.entries?.length) continue
    if (item.params?.filmIsSeriesBibleCast === true) {
      sharedCasts.unshift(parsed)
    } else if (parsed.entries.some((e) => !!(e.imageRelativePath?.trim() || e.imageUrl?.trim()))) {
      sharedCasts.push(parsed)
    }
  }
  return sharedCasts.length ? mergeFilmCasts(...sharedCasts) : null
}

const storyboard = computed(() => {
  void graphEditorHosts.revision.value
  return parseFilmStoryboard(params.value.filmStoryboard ?? '')
})

const effectiveStoryboard = computed((): FilmStoryboard | null => {
  if (storyboard.value?.shots?.length) return storyboard.value
  if (!node.value) return null
  return findUpstreamStoryboard(node.value.id)
})

const displayStoryboard = computed((): FilmStoryboard | null => {
  if (kind.value === 'review') return effectiveStoryboard.value
  return storyboard.value
})

function isLocked(shot: FilmShot): boolean {
  return isFilmShotLocked(shot)
}

function writeStoryboard(mutate: (shots: FilmShot[]) => FilmShot[]): void {
  const doc = storyboard.value
  if (!doc) return
  patchParams({ filmStoryboard: stringifyFilmStoryboard({ ...doc, shots: mutate(doc.shots) }) })
}

function toggleShotLock(id: string): void {
  writeStoryboard((shots) =>
    shots.map((shot) => {
      if (shot.id !== id) return shot
      const locked = !isFilmShotLocked(shot)
      return { ...shot, locked, status: locked ? 'approved' : 'draft' }
    })
  )
}

function setAllShotsLock(locked: boolean): void {
  writeStoryboard((shots) =>
    shots.map((shot) => ({
      ...shot,
      locked,
      status: locked ? ('approved' as const) : ('draft' as const)
    }))
  )
}

function patchShot(
  id: string,
  field: 'shotSize' | 'angle' | 'cameraMove' | 'action' | 'imagePrompt' | 'videoPrompt',
  event: Event
): void {
  const value = inputValue(event).trim()
  writeStoryboard((shots) =>
    shots.map((shot) =>
      shot.id === id ? { ...shot, [field]: value, locked: true, status: 'approved' as const } : shot
    )
  )
}

function patchShotDuration(id: string, event: Event): void {
  const raw = Math.round(Number(inputValue(event)))
  const durationSec = Number.isFinite(raw) ? Math.min(60, Math.max(1, raw)) : 4
  writeStoryboard((shots) =>
    shots.map((shot) =>
      shot.id === id ? { ...shot, durationSec, locked: true, status: 'approved' as const } : shot
    )
  )
}

function patchShotLocation(id: string, event: Event): void {
  const location = inputValue(event).trim()
  writeStoryboard((shots) =>
    shots.map((shot) =>
      shot.id === id ? { ...shot, location, locked: true, status: 'approved' as const } : shot
    )
  )
}

function bindCharacterToShot(shotId: string, name: string): void {
  writeStoryboard((shots) =>
    shots.map((shot) => {
      if (shot.id !== shotId) return shot
      if (shot.characters.some((c) => filmNameKey(c) === filmNameKey(name))) return shot
      return {
        ...shot,
        characters: [...shot.characters, name],
        locked: true,
        status: 'approved' as const
      }
    })
  )
}

function bindPropToShot(shotId: string, name: string): void {
  writeStoryboard((shots) =>
    shots.map((shot) => {
      if (shot.id !== shotId) return shot
      if (shot.props.some((p) => filmNameKey(p) === filmNameKey(name))) return shot
      return {
        ...shot,
        props: [...shot.props, name],
        locked: true,
        status: 'approved' as const
      }
    })
  )
}

function unbindEntityFromShot(shotId: string, entityKind: FilmEntityKind, name: string): void {
  const key = filmNameKey(name)
  writeStoryboard((shots) =>
    shots.map((shot) => {
      if (shot.id !== shotId) return shot
      if (entityKind === 'location') {
        return { ...shot, location: '', locked: true, status: 'approved' as const }
      }
      if (entityKind === 'prop') {
        return {
          ...shot,
          props: shot.props.filter((p) => filmNameKey(p) !== key),
          locked: true,
          status: 'approved' as const
        }
      }
      return {
        ...shot,
        characters: shot.characters.filter((c) => filmNameKey(c) !== key),
        locked: true,
        status: 'approved' as const
      }
    })
  )
}

// ─── 设定库 ───
const castKinds = computed((): FilmEntityKind[] => {
  return parseFilmCastKinds(params.value.filmCastKinds)
})
const selectedCastKindsLabel = computed(() =>
  castKinds.value.map((k) => t(`graph.inspector.film.kind.${k}`)).join(' / ')
)
const cast = computed(() => {
  void graphEditorHosts.revision.value
  return parseFilmCast(params.value.filmCast ?? '')
})
const incomingCast = computed((): FilmCast | null => {
  void graphEditorHosts.revision.value
  if (!node.value) return null
  return findUpstreamCast(node.value.id)
})
const mergedPriorCast = computed((): FilmCast | null =>
  mergeFilmCasts(incomingCast.value, cast.value)
)
const effectiveCast = computed((): FilmCast | null => {
  if (effectiveStoryboard.value) {
    return deriveFilmCast(effectiveStoryboard.value, mergedPriorCast.value, castKinds.value)
  }
  return mergedPriorCast.value
})
const castEntries = computed(() => effectiveCast.value?.entries ?? [])
const hasCastOutputs = computed(() =>
  castEntries.value.some((entry) => !!(entry.imageRelativePath?.trim() || entry.imageUrl?.trim()))
)
const sharedSeriesBibleCastCount = computed(() => {
  return incomingCast.value?.entries?.length ?? 0
})

function syncCurrentCastAsSeriesBible(): void {
  const current = node.value
  const doc = effectiveCast.value
  if (!current || !doc || !props.hostId) return
  const serialized = stringifyFilmCast(doc)
  patchParams({
    filmCast: serialized,
    filmIsSeriesBibleCast: true
  })
  for (const item of pipelineNodes.value) {
    if (item.id === current.id) continue
    if (item.typeId !== 'film.workbench' && item.typeId !== 'film.cast') continue
    const otherLocal = parseFilmCast(item.params?.filmCast ?? '')
    const synced = mergeFilmCasts(doc, otherLocal)
    graphEditorHosts.updateNode(props.hostId, item.id, {
      ...(synced ? { filmCast: stringifyFilmCast(synced) } : {}),
      filmIsSeriesBibleCast: false
    })
  }
}

function patchCastVoicePreset(id: string, event: Event): void {
  const doc = effectiveCast.value
  if (!doc) return
  const voicePreset = inputValue(event).trim() || 'alloy'
  const targetEntry = doc.entries.find((e) => e.id === id)
  const targetKey = targetEntry ? filmNameKey(targetEntry.name) : ''
  const nextCast: FilmCast = {
    ...doc,
    entries: doc.entries.map((entry) => (entry.id === id ? { ...entry, voicePreset } : entry))
  }
  const sb = storyboard.value
  const nextSbPatch =
    sb && targetKey
      ? {
          filmStoryboard: stringifyFilmStoryboard({
            ...sb,
            entities: sb.entities.map((ent) =>
              ent.kind === 'character' && filmNameKey(ent.name) === targetKey
                ? { ...ent, voicePreset }
                : ent
            )
          })
        }
      : {}
  patchParams({
    filmCast: stringifyFilmCast(nextCast),
    ...nextSbPatch
  })
}

function toggleCastKind(castKind: FilmEntityKind): void {
  const next = castKinds.value.includes(castKind)
    ? castKinds.value.filter((k) => k !== castKind)
    : [...castKinds.value, castKind]
  patchParams({ filmCastKinds: (next.length ? next : ['character']).join(', ') })
}

function toggleCastLock(id: string): void {
  const doc = effectiveCast.value
  if (!doc) return
  patchParams({
    filmCast: stringifyFilmCast({
      ...doc,
      entries: doc.entries.map((entry) =>
        entry.id === id ? { ...entry, locked: !entry.locked } : entry
      )
    })
  })
}

function patchCastDescription(id: string, event: Event): void {
  const doc = effectiveCast.value
  if (!doc) return
  const description = inputValue(event).trim()
  patchParams({
    filmCast: stringifyFilmCast({
      ...doc,
      entries: doc.entries.map((entry) => (entry.id === id ? { ...entry, description } : entry))
    })
  })
}

function patchCastField(
  id: string,
  field: 'stateCode' | 'dimensions' | 'worldLightDirection',
  event: Event
): void {
  const doc = effectiveCast.value
  if (!doc) return
  const val = inputValue(event).trim()
  patchParams({
    filmCast: stringifyFilmCast({
      ...doc,
      entries: doc.entries.map((entry) => (entry.id === id ? { ...entry, [field]: val } : entry))
    })
  })
}

function patchCastHeight(id: string, event: Event): void {
  const doc = effectiveCast.value
  if (!doc) return
  const n = Math.round(Number(inputValue(event)))
  const heightCm = Number.isFinite(n) && n >= 40 && n <= 300 ? n : undefined
  patchParams({
    filmCast: stringifyFilmCast({
      ...doc,
      entries: doc.entries.map((entry) => (entry.id === id ? { ...entry, heightCm } : entry))
    })
  })
}

function runSingleCastEntry(entryId: string): void {
  if (runStatus.value === 'running' || blocked.value) return
  runningTargetId.value = entryId
  syncSelectedModelsToParams()
  const doc = effectiveCast.value
  patchParams({
    ...(doc ? { filmCast: stringifyFilmCast(doc) } : {}),
    filmCastOnlyId: entryId
  })
  toggleRun()
}

// ─── 单镜装配预览 ───
function stepShot(delta: number): void {
  const raw = String(params.value.filmShotRef ?? '1').trim()
  const n = parseInt(raw, 10)
  const next = Number.isFinite(n) && String(n) === raw ? Math.max(1, n + delta) : 1
  patchParams({ filmShotRef: String(next) })
}

function selectShotRef(refStr: string): void {
  patchParams({ filmShotRef: refStr })
}

const pipelineNodes = computed((): GraphNode[] => {
  void graphEditorHosts.revision.value
  const doc = graphEditorHosts.getDocument(props.hostId)
  return (doc?.nodes ?? []).filter((n) => isFilmNodeTypeId(n.typeId))
})

/** 全图可用的角色场景设定库（即使当前在拆解/审核页签，也能看到同图已生成的设定图缩略图与 @n 编号） */
const graphCast = computed((): FilmCast | null => {
  const merged = mergeFilmCasts(incomingCast.value, cast.value, effectiveCast.value)
  if (merged?.entries?.length) return merged
  for (const item of pipelineNodes.value) {
    if (item.typeId !== 'film.cast' && item.typeId !== 'film.workbench') continue
    const parsed = parseFilmCast(item.params.filmCast ?? '')
    if (parsed?.entries?.length) return parsed
  }
  return null
})

const selectedShot = computed((): FilmShot | null => {
  const doc = effectiveStoryboard.value
  if (!doc) return null
  return selectFilmShot(doc, params.value.filmShotRef ?? '1')
})

const matchedShotCastRefs = computed(() => {
  if (!selectedShot.value) return []
  return matchFilmCastForShot(graphCast.value, selectedShot.value)
})

// ─── 批量拍摄监控 ───
const renderCache = computed(() => {
  void graphEditorHosts.revision.value
  return parseFilmRenderCache(params.value.filmRenders)
})
const graphRenderCache = computed(() => {
  if (Object.keys(renderCache.value).length) return renderCache.value
  for (const item of pipelineNodes.value) {
    if (item.typeId !== 'film.render' && item.typeId !== 'film.workbench') continue
    const parsed = parseFilmRenderCache(item.params.filmRenders)
    if (Object.keys(parsed).length) return parsed
  }
  return renderCache.value
})
const hasRenderOutputs = computed(() => Object.keys(renderCache.value).length > 0)

function shotRawKeyframe(shot: FilmShot | null | undefined): string {
  if (!shot) return ''
  return (
    renderCache.value[shot.id]?.keyframe ||
    graphRenderCache.value[shot.id]?.keyframe ||
    shot.media?.keyframe ||
    ''
  ).trim()
}

function shotRawVideo(shot: FilmShot | null | undefined): string {
  if (!shot) return ''
  return (
    renderCache.value[shot.id]?.video ||
    graphRenderCache.value[shot.id]?.video ||
    shot.media?.video ||
    ''
  ).trim()
}

function shotRawVoice(shot: FilmShot | null | undefined): string {
  if (!shot) return ''
  return (
    renderCache.value[shot.id]?.voice ||
    graphRenderCache.value[shot.id]?.voice ||
    shot.media?.voice ||
    ''
  ).trim()
}

const composedEpisodeVideoRelPath = computed((): string => {
  return (
    effectivePublishPack.value?.composedVideoPath?.trim() ||
    params.value.filmComposedVideoPath?.trim() ||
    ''
  )
})

const composedEpisodeVideoUrl = computed((): string => {
  return mediaThumbUrl(composedEpisodeVideoRelPath.value)
})

const composedShotCount = computed((): number => {
  if (effectivePublishPack.value?.composedShotCount) {
    return effectivePublishPack.value.composedShotCount
  }
  const shots = effectiveStoryboard.value?.shots ?? []
  return shots.filter((s) => !!(shotRawVideo(s) || shotRawKeyframe(s))).length
})

const composedVoiceCount = computed((): number => {
  if (effectivePublishPack.value?.composedVoiceCount) {
    return effectivePublishPack.value.composedVoiceCount
  }
  const shots = effectiveStoryboard.value?.shots ?? []
  return shots.filter((s) => !!shotRawVoice(s)).length
})

function runComposeEpisodeVideo(): void {
  if (runStatus.value === 'running' || blocked.value) return
  syncSelectedModelsToParams()
  patchParams({ filmWorkbenchRunMode: 'publish' })
  toggleRun()
}

const stageRunStatus = computed((): GraphNodeRunStatus | undefined => {
  if (!isWorkbenchNode.value) return runStatus.value
  if (runStatus.value === 'running' || runStatus.value === 'pending') return runStatus.value
  if (kind.value === 'breakdown') {
    return (storyboard.value?.shots?.length ?? 0) > 0 ? 'done' : 'idle'
  }
  if (kind.value === 'review') {
    const hasReview = Boolean(
      params.value.filmReviewVerdict?.trim() ||
      params.value.filmReviewReport?.trim() ||
      storyboard.value?.review?.verdict
    )
    return hasReview ? 'done' : 'idle'
  }
  if (kind.value === 'cast') {
    return hasCastOutputs.value ? 'done' : 'idle'
  }
  if (kind.value === 'render') {
    const hasAnyRender =
      hasRenderOutputs.value ||
      (effectiveStoryboard.value?.shots ?? []).some(
        (s) => !!(shotRawKeyframe(s) || shotRawVideo(s))
      )
    return hasAnyRender ? 'done' : 'idle'
  }
  if (kind.value === 'publish') {
    return effectiveStoryboard.value?.publishPack ? 'done' : 'idle'
  }
  return runStatus.value
})

function prevSameSceneShot(shot: FilmShot | null | undefined): FilmShot | null {
  const doc = displayStoryboard.value ?? effectiveStoryboard.value
  return findPrevSameSceneShot(doc, shot)
}

function prevShotKeyframeRefIndex(shot: FilmShot | null | undefined): number {
  if (!shot) return 0
  const prev = prevSameSceneShot(shot)
  if (!prev || !shotRawKeyframe(prev)) return 0
  const refs = matchFilmCastForShot(graphCast.value, shot)
  return refs.length + 1
}

function shotRawPrevizKeyframe(shot: FilmShot | null | undefined): string {
  if (!shot) return ''
  const direct = (shot.media?.previzKeyframe ?? '').trim()
  if (direct) return direct
  return resolveFilmShotPrevizMediaFromStage(directorStage.value, shot.id).previzKeyframe ?? ''
}

function shotRawPrevizVideo(shot: FilmShot | null | undefined): string {
  if (!shot) return ''
  const direct = (shot.media?.previzVideo ?? '').trim()
  if (direct) return direct
  return resolveFilmShotPrevizMediaFromStage(directorStage.value, shot.id).previzVideo ?? ''
}

function shotPrevizThumbUrl(shot: FilmShot | null | undefined): string {
  return mediaThumbUrl(shotRawPrevizKeyframe(shot))
}

function shotPrevizVideoUrl(shot: FilmShot | null | undefined): string {
  return mediaThumbUrl(shotRawPrevizVideo(shot))
}

function shotPrevizRefIndex(shot: FilmShot | null | undefined, includeContinuity = true): number {
  if (!shot || !shotRawPrevizKeyframe(shot)) return 0
  const refs = matchFilmCastForShot(graphCast.value, shot)
  const hasPrev = includeContinuity && prevShotKeyframeRefIndex(shot) > 0
  return refs.length + (hasPrev ? 1 : 0) + 1
}

function clearShotPreviz(shotId: string): void {
  writeStoryboard((shots) =>
    shots.map((shot) => {
      if (shot.id !== shotId || (!shot.media?.previzKeyframe && !shot.media?.previzVideo)) {
        return shot
      }
      const nextMedia = { ...shot.media }
      delete nextMedia.previzKeyframe
      delete nextMedia.previzVideo
      return {
        ...shot,
        media: Object.keys(nextMedia).length > 0 ? nextMedia : undefined
      }
    })
  )
}

const previzOpeningKey = ref<string | null>(null)

async function openInDirectorPreviz(options?: {
  sceneId?: string | null
  shotId?: string | null
}): Promise<void> {
  if (previzOpeningKey.value !== null) return
  const sb = displayStoryboard.value ?? effectiveStoryboard.value
  if (!sb || !sb.shots.length) return
  const directorAssetId = hostAssetId.value
  if (!directorAssetId) return

  previzOpeningKey.value = options?.shotId ?? '__all__'
  try {
    const doc = graphEditorHosts.getDocument(props.hostId)
    const edges = doc?.edges ?? []
    const previzTitle = t('graph.inspector.film.previzDirectorNodeTitle')
    const directorNodes = (doc?.nodes ?? []).filter((n) => isDirectorProcessingNode(n))
    const hasIncomingModelEdge = (nodeId: string): boolean =>
      edges.some(
        (e) => e.target === nodeId && (e.targetPort === 'in-model' || e.targetPort === 'model')
      )

    let motionNode =
      directorNodes.find((n) =>
        edges.some((e) => e.source === props.nodeId && e.target === n.id)
      ) ??
      directorNodes.find((n) => n.title === previzTitle && !hasIncomingModelEdge(n.id)) ??
      directorNodes.find((n) => !hasIncomingModelEdge(n.id)) ??
      null
    let motionNodeId = motionNode?.id ?? null

    if (!motionNodeId) {
      motionNodeId = graphEditorHosts.addNode(props.hostId, {
        typeId: 'asset.motion',
        title: previzTitle,
        position: {
          x: node.value?.position.x ?? 0,
          y: (node.value?.position.y ?? 0) - 240
        }
      })
    }
    if (!motionNodeId) return

    const currentDoc = graphEditorHosts.getDocument(props.hostId) ?? doc
    const currentStage = resolveDirectorStageForNode(
      hostAsset.value?.genParams,
      currentDoc,
      motionNodeId
    )
    const previzOptions = {
      sceneId: options?.sceneId ?? null,
      shotId: options?.shotId ?? null,
      locale: String(locale.value),
      model: params.value.filmTextModel || undefined,
      providerInstanceId: params.value.filmTextProviderInstanceId || undefined
    }
    const stageWithOwner = {
      ...currentStage,
      ownerProcessingNodeId: motionNodeId
    }

    if (!canReuseCompiledStoryboardStage(stageWithOwner, sb, previzOptions)) {
      const compiled = await compileStoryboardToDirectorStageWithLlm(
        stageWithOwner,
        sb,
        previzOptions
      )
      compiled.stage.ownerProcessingNodeId = motionNodeId
      markCompiledStoryboardStage(compiled.stage, sb, previzOptions)

      const nextGenParams = patchGenParamsWithNodeStage(
        hostAsset.value?.genParams,
        motionNodeId,
        compiled.stage
      )
      await persistAssetRecord(directorAssetId, { genParams: nextGenParams })
      await graphEditorHosts.flush(props.hostId)
    }

    await diveCtx?.diveView(
      {
        viewId: 'director.stage',
        directorAssetId,
        processingNodeId: motionNodeId
      },
      previzTitle
    )
  } finally {
    previzOpeningKey.value = null
  }
}

const directorStage = computed(() => {
  void graphEditorHosts.revision.value
  return resolveFilmDirectorStage({
    node: node.value,
    document: graphEditorHosts.getDocument(props.hostId),
    genParams: hostAsset.value?.genParams as Record<string, unknown> | undefined,
    storyboard: effectiveStoryboard.value
  })
})

function shotPrevizSpecs(shot: FilmShot | null | undefined): {
  previzImageSpec?: string
  previzVideoSpec?: string
} {
  if (!shot) return {}
  const spec = resolveFilmShotPrevizCinematography(directorStage.value, shot.id)
  if (!spec) return {}
  const en = String(locale.value).toLowerCase().startsWith('en')
  return {
    previzImageSpec: en ? spec.imageSpecEn : spec.imageSpecZh,
    previzVideoSpec: en ? spec.videoSpecEn : spec.videoSpecZh
  }
}

const composedSelectedImagePrompt = computed(() => {
  const doc = effectiveStoryboard.value
  const shot = selectedShot.value
  if (!doc || !shot) return ''
  const prevShot = findPrevSameSceneShot(doc, shot)
  const prevRefIdx = prevShotKeyframeRefIndex(shot)
  const previzRefIdx = shotPrevizRefIndex(shot, true)
  const { previzImageSpec } = shotPrevizSpecs(shot)
  return composeFilmShotImagePrompt(
    doc,
    shot,
    matchedShotCastRefs.value,
    String(locale.value),
    prevShot || previzRefIdx > 0 || previzImageSpec
      ? {
          ...(prevShot
            ? {
                prevShot,
                prevKeyframeRefIndex: prevRefIdx > 0 ? prevRefIdx : undefined
              }
            : {}),
          ...(previzRefIdx > 0 ? { previzRefIndex: previzRefIdx } : {}),
          ...(previzImageSpec ? { previzImageSpec } : {})
        }
      : undefined
  )
})

const composedSelectedVideoPrompt = computed(() => {
  const doc = effectiveStoryboard.value
  const shot = selectedShot.value
  if (!shot) return ''
  const prevShot = findPrevSameSceneShot(doc, shot)
  const { previzVideoSpec } = shotPrevizSpecs(shot)
  const hasPrevizVideoRef =
    params.value.filmRenderPrevizVideoRef !== false && Boolean(shotRawPrevizVideo(shot))
  return composeFilmShotVideoPrompt(shot, String(locale.value), {
    ...(prevShot ? { prevShot } : {}),
    ...(previzVideoSpec ? { previzVideoSpec } : {}),
    ...(hasPrevizVideoRef ? { hasPrevizVideoRef: true } : {}),
    castRefs: matchedShotCastRefs.value,
    storyboard: doc ?? undefined
  })
})

function runSingleRenderShot(shotId: string): void {
  if (runStatus.value === 'running' || blocked.value) return
  runningTargetId.value = shotId
  syncSelectedModelsToParams()
  patchParams({ filmRenderOnlyShotId: shotId })
  toggleRun()
}

const expandedRenderPromptIds = ref<Record<string, boolean>>({})

function isRenderPromptExpanded(shotId: string): boolean {
  return !!expandedRenderPromptIds.value[shotId]
}

function toggleRenderPromptPreview(shotId: string): void {
  expandedRenderPromptIds.value = {
    ...expandedRenderPromptIds.value,
    [shotId]: !expandedRenderPromptIds.value[shotId]
  }
}

const allRenderPromptsExpanded = computed((): boolean => {
  const shots = effectiveStoryboard.value?.shots ?? []
  return shots.length > 0 && shots.every((shot) => !!expandedRenderPromptIds.value[shot.id])
})

function toggleAllRenderPrompts(): void {
  const shots = effectiveStoryboard.value?.shots ?? []
  const nextVal = !allRenderPromptsExpanded.value
  const next: Record<string, boolean> = {}
  for (const shot of shots) next[shot.id] = nextVal
  expandedRenderPromptIds.value = next
}

function composeRenderFinalImagePrompt(shot: FilmShot): string {
  const doc = effectiveStoryboard.value
  if (!doc) return ''
  const refs = matchFilmCastForShot(graphCast.value, shot)
  const continuityOn = params.value.filmRenderContinuity !== false
  const prevShot = continuityOn ? findPrevSameSceneShot(doc, shot) : null
  const prevRefIdx = continuityOn ? prevShotKeyframeRefIndex(shot) : 0
  const previzRefIdx = shotPrevizRefIndex(shot, continuityOn)
  const { previzImageSpec } = shotPrevizSpecs(shot)
  const composed = composeFilmShotImagePrompt(
    doc,
    shot,
    refs,
    String(locale.value),
    prevShot || previzRefIdx > 0 || previzImageSpec
      ? {
          ...(prevShot
            ? {
                prevShot,
                prevKeyframeRefIndex: prevRefIdx > 0 ? prevRefIdx : undefined
              }
            : {}),
          ...(previzRefIdx > 0 ? { previzRefIndex: previzRefIdx } : {}),
          ...(previzImageSpec ? { previzImageSpec } : {})
        }
      : undefined
  )
  const extra = params.value.generateInstruction?.trim() || ''
  return extra ? `${composed}\n${extra}` : composed
}

function composeRenderFinalVideoPrompt(shot: FilmShot): string {
  const doc = effectiveStoryboard.value
  const refs = matchFilmCastForShot(graphCast.value, shot)
  const continuityOn = params.value.filmRenderContinuity !== false
  const prevShot = continuityOn ? findPrevSameSceneShot(doc, shot) : null
  const { previzVideoSpec } = shotPrevizSpecs(shot)
  const hasPrevizVideoRef =
    params.value.filmRenderPrevizVideoRef !== false && Boolean(shotRawPrevizVideo(shot))
  return composeFilmShotVideoPrompt(shot, String(locale.value), {
    ...(prevShot ? { prevShot } : {}),
    ...(previzVideoSpec ? { previzVideoSpec } : {}),
    ...(hasPrevizVideoRef ? { hasPrevizVideoRef: true } : {}),
    castRefs: refs,
    storyboard: doc ?? undefined
  })
}

// ─── 卡片可视化绑定与缩略图解析 ───
const resolvedPreviewUrls = ref<Record<string, string>>({})

const allMediaRelativePaths = computed((): string[] => {
  const set = new Set<string>()
  const push = (rel: string | undefined): void => {
    const val = rel?.trim()
    if (val && !val.startsWith('data:') && !/^https?:\/\//i.test(val)) set.add(val)
  }
  for (const entry of castEntries.value) push(entry.imageRelativePath)
  for (const entry of graphCast.value?.entries ?? []) push(entry.imageRelativePath)
  for (const shot of displayStoryboard.value?.shots ?? []) {
    push(shot.media?.keyframe)
    push(shot.media?.video)
    push(shot.media?.voice)
    push(shot.media?.previzKeyframe)
    push(shot.media?.previzVideo)
  }
  for (const shot of effectiveStoryboard.value?.shots ?? []) {
    push(shot.media?.keyframe)
    push(shot.media?.video)
    push(shot.media?.voice)
    push(shot.media?.previzKeyframe)
    push(shot.media?.previzVideo)
  }
  for (const snap of directorStage.value?.stage.cameraShots ?? []) {
    push(snap.relativePath)
  }
  for (const vid of directorStage.value?.stage.cameraVideos ?? []) {
    push(vid.relativePath)
  }
  for (const entry of Object.values(renderCache.value)) {
    push(entry?.keyframe)
    push(entry?.video)
    push(entry?.voice)
  }
  for (const entry of Object.values(graphRenderCache.value)) {
    push(entry?.keyframe)
    push(entry?.video)
    push(entry?.voice)
  }
  push(composedEpisodeVideoRelPath.value)
  return [...set]
})

watch(
  allMediaRelativePaths,
  async (paths) => {
    if (typeof window === 'undefined' || !window.studio?.getAssetPreviewUrl) return
    const next = { ...resolvedPreviewUrls.value }
    let changed = false
    for (const rel of paths) {
      if (next[rel]) continue
      try {
        const url = await window.studio.getAssetPreviewUrl(rel)
        if (url) {
          next[rel] = url
          changed = true
        }
      } catch {
        /* ignore */
      }
    }
    if (changed) resolvedPreviewUrls.value = next
  },
  { immediate: true }
)

function mediaThumbUrl(raw: string | undefined): string {
  const val = raw?.trim() ?? ''
  if (!val) return ''
  if (val.startsWith('data:') || /^https?:\/\//i.test(val) || val.startsWith('file:')) return val
  return resolvedPreviewUrls.value[val] ?? ''
}

function previewMedia(url: string, title?: string): void {
  if (!url) return
  void openFullImagePreview({ dataUrl: url, title, mediaKind: 'image' })
}

function previewVideoMedia(url: string, title?: string): void {
  if (!url) return
  void openFullImagePreview({ dataUrl: url, title, mediaKind: 'video' })
}

function entityThumbUrl(entityKind: FilmEntityKind, name: string): string {
  const entries = graphCast.value?.entries ?? []
  const key = `${entityKind}:${filmNameKey(name)}`
  let entry = entries.find(
    (e) => `${e.kind}:${filmNameKey(e.name)}` === key && !!filmCastEntryImage(e)
  )
  if (!entry) {
    const base = filmBaseEntityName(name)
    if (base) {
      const baseKey = `${entityKind}:${filmNameKey(base)}`
      entry = entries.find(
        (e) => `${e.kind}:${filmNameKey(e.name)}` === baseKey && !!filmCastEntryImage(e)
      )
    }
  }
  return entry ? mediaThumbUrl(filmCastEntryImage(entry)) : ''
}

function shotKeyframeThumbUrl(shot: FilmShot): string {
  return mediaThumbUrl(shotRawKeyframe(shot))
}

function shotVideoUrl(shot: FilmShot): string {
  return mediaThumbUrl(shotRawVideo(shot))
}

function shotVoiceUrl(shot: FilmShot): string {
  return mediaThumbUrl(shotRawVoice(shot))
}

function shotsUsingEntity(entityKind: FilmEntityKind, name: string): FilmShot[] {
  const key = filmNameKey(name)
  const doc = displayStoryboard.value ?? effectiveStoryboard.value
  if (!doc || !key) return []
  return doc.shots.filter((shot) => {
    if (entityKind === 'location') return filmNameKey(shot.location) === key
    if (entityKind === 'prop') return shot.props.some((p) => filmNameKey(p) === key)
    return shot.characters.some((c) => filmNameKey(c) === key)
  })
}

export interface ShotBindingVisualItem {
  kind: FilmEntityKind
  name: string
  /** 1-based reference index (@1, @2...) when a design sheet is ready, or 0 when pending */
  refIndex: number
  thumbUrl: string
}

function shotBindingItems(shot: FilmShot): ShotBindingVisualItem[] {
  const refs = matchFilmCastForShot(graphCast.value, shot)
  const refIndexByKey = new Map<string, { index: number; thumbUrl: string }>()
  refs.forEach((ref, idx) => {
    refIndexByKey.set(`${ref.kind}:${filmNameKey(ref.name)}`, {
      index: idx + 1,
      thumbUrl: mediaThumbUrl(filmCastEntryImage(ref))
    })
  })
  const items: ShotBindingVisualItem[] = []
  const push = (entityKind: FilmEntityKind, name: string): void => {
    const trimmed = name.trim()
    if (!trimmed) return
    const key = `${entityKind}:${filmNameKey(trimmed)}`
    let hit = refIndexByKey.get(key)
    if (!hit) {
      const base = filmBaseEntityName(trimmed)
      if (base) hit = refIndexByKey.get(`${entityKind}:${filmNameKey(base)}`)
    }
    items.push({
      kind: entityKind,
      name: trimmed,
      refIndex: hit?.index ?? 0,
      thumbUrl: hit?.thumbUrl || entityThumbUrl(entityKind, trimmed)
    })
  }
  for (const ch of shot.characters) push('character', ch)
  if (shot.location) push('location', shot.location)
  for (const prop of shot.props) push('prop', prop)
  return items
}

const availableLocations = computed((): FilmEntity[] => {
  const doc = displayStoryboard.value ?? effectiveStoryboard.value
  return (doc?.entities ?? []).filter((e) => e.kind === 'location')
})

function unboundCharactersForShot(shot: FilmShot): FilmEntity[] {
  const doc = displayStoryboard.value ?? effectiveStoryboard.value
  const existing = new Set(shot.characters.map((c) => filmNameKey(c)))
  return (doc?.entities ?? []).filter(
    (e) => e.kind === 'character' && !existing.has(filmNameKey(e.name))
  )
}

function unboundPropsForShot(shot: FilmShot): FilmEntity[] {
  const doc = displayStoryboard.value ?? effectiveStoryboard.value
  const existing = new Set(shot.props.map((p) => filmNameKey(p)))
  return (doc?.entities ?? []).filter(
    (e) => e.kind === 'prop' && !existing.has(filmNameKey(e.name))
  )
}
</script>

<style scoped>
.dive-film {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: auto;
  background: var(--bg);
  color: var(--text);
}

.workbench-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-elevated, var(--bg));
  flex-wrap: wrap;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.kind-badge {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border-radius: 8px;
  background: color-mix(in srgb, var(--accent) 18%, transparent);
  color: var(--accent);
  border: 1px solid color-mix(in srgb, var(--accent) 40%, var(--border));
}

.title-input {
  border: 1px solid transparent;
  background: transparent;
  color: var(--text);
  font-size: 14px;
  font-weight: 600;
  padding: 4px 8px;
  border-radius: 6px;
  min-width: 120px;
  max-width: 220px;
}

.title-input:hover,
.title-input:focus {
  border-color: var(--border);
  background: var(--bg);
}

.pipeline-tabs {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.pipeline-label {
  font-size: 11px;
  color: var(--text-muted);
  margin-right: 4px;
}

.pipeline-tab {
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text-muted);
  font-size: 12px;
  padding: 4px 10px;
  border-radius: 6px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.pipeline-tab.active {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 16%, var(--bg));
  color: var(--text);
  font-weight: 600;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-left: auto;
}

.header-right :deep(.node-run-btn) {
  width: auto;
  padding: 5px 12px;
  border-radius: 6px;
  font-size: 12px;
  white-space: nowrap;
}

.full-pipeline-btn {
  border: 1px solid color-mix(in srgb, var(--accent) 55%, var(--border));
  background: color-mix(in srgb, var(--accent) 16%, var(--bg));
  color: var(--text);
  font-size: 12px;
  font-weight: 600;
  padding: 5px 12px;
  border-radius: 6px;
  cursor: pointer;
  white-space: nowrap;
}

.full-pipeline-btn:hover:not(:disabled) {
  background: color-mix(in srgb, var(--accent) 26%, var(--bg));
}

.full-pipeline-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.stage-run-hint {
  font-size: 11px;
  color: var(--text-muted);
  white-space: nowrap;
}

.workbench-body {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 300px minmax(0, 1fr);
  overflow: hidden;
}

.workbench-sidebar {
  border-right: 1px solid var(--border);
  padding: 14px;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
  background: var(--bg-panel, var(--bg));
}

.workbench-main {
  padding: 16px;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}

.hint {
  margin: 0;
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.45;
}

.group {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 10px;
  border-top: 1px solid var(--border);
}

.group h3,
.section-head h3,
.output-section h3 {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
}

label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
  color: var(--text-muted);
}

label.row {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.model-config-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.model-config-label {
  font-size: 11px;
  color: var(--text-muted);
}

.gen-model-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.gen-model-row :deep(.instruction-model) {
  max-width: 160px;
}

.gen-model-row :deep(.instruction-model select) {
  max-width: 140px;
}

label.check,
label.inline {
  flex-direction: row;
  align-items: center;
  gap: 6px;
}

input[type='text'],
input[type='number'],
select,
textarea {
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text);
  border-radius: 6px;
  padding: 6px 8px;
  font-size: 12px;
  font-family: inherit;
}

textarea {
  resize: vertical;
  line-height: 1.45;
}

.grid2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.checks {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.segmented {
  display: flex;
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
}

.segmented button {
  flex: 1;
  padding: 6px 8px;
  border: none;
  background: var(--bg);
  color: var(--text);
  font-size: 12px;
  cursor: pointer;
}

.segmented button.active {
  background: var(--accent);
  color: var(--accent-fg);
  font-weight: 600;
}

.stepper {
  display: flex;
  gap: 6px;
}

.stepper input {
  flex: 1;
  text-align: center;
}

.stepper button,
.lock,
.ghost-btn {
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text);
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
  padding: 4px 10px;
}

.lock.on {
  border-color: var(--accent);
}

.card-run-btn {
  border: 1px solid color-mix(in srgb, var(--accent) 45%, var(--border));
  background: color-mix(in srgb, var(--accent) 12%, var(--bg));
  color: var(--text);
  border-radius: 6px;
  cursor: pointer;
  font-size: 11px;
  padding: 2px 8px;
  white-space: nowrap;
  transition:
    background 0.15s ease,
    border-color 0.15s ease;
}

.card-run-btn:hover:not(:disabled) {
  background: color-mix(in srgb, var(--accent) 22%, var(--bg));
  border-color: var(--accent);
}

.card-run-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.shot-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 4px;
}

.shot-pill {
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text-muted);
  border-radius: 6px;
  padding: 2px 8px;
  font-size: 11px;
  cursor: pointer;
}

.shot-pill.active {
  border-color: var(--accent);
  color: var(--accent);
  font-weight: 600;
}

.review-banner {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px;
  background: var(--bg-elevated, var(--bg));
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.review-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.verdict {
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
}

.verdict.pass {
  background: color-mix(in srgb, var(--success, #2e9e5b) 22%, transparent);
  color: var(--success, #2e9e5b);
}

.verdict.fail {
  background: color-mix(in srgb, var(--danger, #d0583a) 22%, transparent);
  color: var(--danger, #d0583a);
}

.score-chip {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
}

.report {
  margin: 0;
  padding: 8px;
  max-height: 200px;
  overflow: auto;
  white-space: pre-wrap;
  font-size: 11px;
  line-height: 1.45;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
}

.entities-bar,
.shots-section,
.output-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.batch-actions {
  display: flex;
  gap: 8px;
}

.entity-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.entity-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-elevated, var(--bg));
  font-size: 12px;
  max-width: 360px;
}

.entity-desc {
  color: var(--text-muted);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.badge,
.tag {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 999px;
  border: 1px solid var(--border);
  color: var(--text-muted);
  white-space: nowrap;
}

.shot-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));
  gap: 12px;
}

.cast-grid,
.render-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
}

.shot-card,
.cast-card,
.render-card {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px;
  background: var(--bg-elevated, var(--bg));
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.shot-card.fail,
.render-card.fail {
  border-color: var(--danger, #d0583a);
}

.shot-card.locked,
.cast-card.locked {
  border-color: color-mix(in srgb, var(--accent) 65%, var(--border));
}

.shot-card-head,
.cast-card-head {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.shot-index {
  font-size: 11px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.sid {
  font-weight: 700;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.meta {
  font-size: 11px;
  color: var(--text-muted);
}

.spacer {
  flex: 1;
}

.shot-meta-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px;
}

.dialogue-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 8px;
  border-radius: 6px;
  background: var(--bg);
  font-size: 11px;
}

.review-note {
  margin: 0;
  font-size: 11px;
  color: var(--danger, #d0583a);
}

.cast-name {
  flex: 1;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.state {
  font-size: 12px;
  color: var(--text-muted);
}

.state.ok {
  color: var(--success, #2e9e5b);
}

.status-pill {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 999px;
  border: 1px solid var(--border);
  color: var(--text-muted);
}

.status-pill.ok {
  border-color: color-mix(in srgb, var(--success, #2e9e5b) 50%, var(--border));
  color: var(--success, #2e9e5b);
}

.status-pill.fail {
  border-color: color-mix(in srgb, var(--danger, #d0583a) 50%, var(--border));
  color: var(--danger, #d0583a);
}

.render-action {
  margin: 0;
  font-size: 12px;
  line-height: 1.45;
  color: var(--text);
}

.empty-panel {
  padding: 36px 24px;
  border: 1px dashed var(--border);
  border-radius: 8px;
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.empty-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
}

.empty-sub {
  font-size: 11px;
  color: var(--text-muted);
  max-width: 560px;
  line-height: 1.5;
}

.draft-banner {
  margin: 0;
  padding: 8px 12px;
  border-radius: 6px;
  border: 1px solid color-mix(in srgb, var(--accent) 40%, var(--border));
  background: color-mix(in srgb, var(--accent) 10%, var(--bg));
  color: var(--text);
  font-size: 12px;
}

.entity-mini-thumb,
.binding-thumb {
  width: 24px;
  height: 24px;
  border-radius: 4px;
  object-fit: cover;
  border: 1px solid var(--border);
  cursor: zoom-in;
  flex-shrink: 0;
  background: var(--image-checker-bg);
}

.shot-binding-panel {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border-radius: 6px;
  background: var(--bg);
  border: 1px solid var(--border);
}

.shot-binding-panel.compact {
  padding: 6px;
}

.binding-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.binding-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 8px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg-elevated, var(--bg));
  font-size: 11px;
}

.binding-chip.ready {
  border-color: color-mix(in srgb, var(--success, #2e9e5b) 45%, var(--border));
}

.binding-name {
  font-size: 11px;
  font-weight: 600;
}

.ref-badge {
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 999px;
  border: 1px solid var(--border);
  white-space: nowrap;
}

.ref-badge.ready {
  color: var(--success, #2e9e5b);
  border-color: color-mix(in srgb, var(--success, #2e9e5b) 50%, var(--border));
  background: color-mix(in srgb, var(--success, #2e9e5b) 12%, transparent);
  font-weight: 600;
}

.ref-badge.pending {
  color: var(--text-muted);
}

.binding-remove {
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 13px;
  line-height: 1;
  padding: 0 2px;
}

.binding-remove:hover {
  color: var(--danger, #d0583a);
}

.binding-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.binding-select {
  padding: 2px 6px;
  font-size: 11px;
  border-radius: 6px;
}

.binding-add-btn {
  border: 1px dashed var(--border);
  background: transparent;
  color: var(--text-muted);
  border-radius: 6px;
  font-size: 11px;
  padding: 2px 8px;
  cursor: pointer;
}

.binding-add-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.card-media-preview {
  position: relative;
  border-radius: 6px;
  overflow: hidden;
  border: 1px solid var(--border);
  background: var(--image-checker-bg);
  max-height: 180px;
  cursor: zoom-in;
  display: flex;
  align-items: center;
  justify-content: center;
}

.card-media-preview.video {
  max-height: 220px;
  cursor: default;
  background: var(--bg);
}

.card-media-preview img {
  width: 100%;
  max-height: 180px;
  object-fit: cover;
  display: block;
  background: var(--image-checker-bg);
}

.card-video-player {
  width: 100%;
  max-height: 220px;
  display: block;
  background: #000;
}

.card-keyframe-corner {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 44px;
  height: 28px;
  border-radius: 4px;
  overflow: hidden;
  border: 1px solid var(--border);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.45);
  cursor: zoom-in;
  background: var(--image-checker-bg);
}

.card-keyframe-corner img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.cast-used-shots {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
  padding-top: 2px;
}

.ghost-btn.compact-btn {
  padding: 2px 8px;
  font-size: 11px;
  white-space: nowrap;
}

.ghost-btn.compact-btn.active {
  border-color: var(--accent);
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, var(--bg));
}

.render-prompt-preview {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border-radius: 6px;
  background: var(--bg);
  border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--border));
}

.previz-stage-btn {
  border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
  background: color-mix(in srgb, var(--accent) 14%, var(--bg));
  font-weight: 600;
}

.previz-stage-btn:hover:not(:disabled) {
  background: color-mix(in srgb, var(--accent) 24%, var(--bg));
}

.binding-chip.previz {
  border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
  background: color-mix(in srgb, var(--accent) 10%, var(--bg-elevated, var(--bg)));
}

.manju-genre-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border-radius: 6px;
  border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--border));
  background: color-mix(in srgb, var(--accent) 6%, var(--bg));
}

.manju-genre-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.manju-genre-card .compact-btn.applied {
  border-color: color-mix(in srgb, var(--success, #2a9d6f) 65%, var(--border));
  background: color-mix(in srgb, var(--success, #2a9d6f) 18%, var(--bg));
  color: var(--success, #2a9d6f);
  font-weight: 600;
}

.manju-audit-panel,
.manju-bible-panel,
.manju-publish-panel {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px;
  background: var(--bg-elevated, var(--bg));
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.manju-audit-title-row,
.manju-bible-badges {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.verdict.warn {
  background: color-mix(in srgb, var(--warning, #d99b26) 22%, transparent);
  color: var(--warning, #d99b26);
}

.manju-audit-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 8px;
}

.manju-audit-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg);
  font-size: 11px;
}

.manju-audit-item.fail {
  border-color: color-mix(in srgb, var(--danger, #d0583a) 55%, var(--border));
}

.manju-audit-item.warn {
  border-color: color-mix(in srgb, var(--warning, #d99b26) 55%, var(--border));
}

.manju-audit-status {
  font-size: 10px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 999px;
  flex-shrink: 0;
}

.manju-audit-status.pass {
  background: color-mix(in srgb, var(--success, #2e9e5b) 20%, transparent);
  color: var(--success, #2e9e5b);
}

.manju-audit-status.warn {
  background: color-mix(in srgb, var(--warning, #d99b26) 20%, transparent);
  color: var(--warning, #d99b26);
}

.manju-audit-status.fail {
  background: color-mix(in srgb, var(--danger, #d0583a) 20%, transparent);
  color: var(--danger, #d0583a);
}

.manju-audit-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.manju-audit-body span {
  color: var(--text-muted);
  line-height: 1.4;
}

.manju-hook-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 8px;
}

.manju-hook-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 10px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg);
  font-size: 12px;
}

.manju-hook-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--accent);
}

.manju-bible-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.badge.code-badge,
.badge.accent {
  border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
  color: var(--accent);
  font-weight: 600;
}

.tag.danger-tag {
  border-color: color-mix(in srgb, var(--danger, #d0583a) 45%, var(--border));
  color: var(--danger, #d0583a);
}

.shot-ab-drawer {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border-radius: 6px;
  border: 1px solid color-mix(in srgb, var(--accent) 40%, var(--border));
  background: color-mix(in srgb, var(--accent) 5%, var(--bg));
}

.shot-beats-box {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-top: 4px;
  border-top: 1px dashed var(--border);
}

.shot-beats-title {
  font-size: 11px;
  color: var(--text-muted);
}

.shot-beat-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  font-size: 11px;
}

.dialogue-line {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.manju-genre-synced-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border-radius: 6px;
  border: 1px solid color-mix(in srgb, var(--accent) 45%, var(--border));
  background: color-mix(in srgb, var(--accent) 14%, var(--bg));
  color: var(--accent);
  font-size: 12px;
  font-weight: 600;
}

.manju-publish-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
  gap: 12px;
}

.manju-publish-card {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px;
  background: var(--bg);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.cast-voice-label {
  grid-column: 1 / -1;
}

.card-audio-player {
  width: 100%;
  height: 32px;
  margin-top: 4px;
}

.manju-composed-video-card {
  border: 1px solid color-mix(in srgb, var(--accent) 45%, var(--border));
  border-radius: 10px;
  padding: 12px;
  margin-bottom: 14px;
  background: color-mix(in srgb, var(--accent) 6%, var(--bg));
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.composed-video-player-wrap {
  display: flex;
  justify-content: center;
  background: #000;
  border-radius: 8px;
  overflow: hidden;
  max-height: 440px;
}

.composed-episode-video {
  max-width: 100%;
  max-height: 440px;
  display: block;
}
</style>
