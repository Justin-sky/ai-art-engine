<template>
  <div v-if="node" class="node-inspector film-inspector">
    <div class="head">
      <h2>{{ displayTitle }}</h2>
    </div>
    <p class="hint">
      {{ t(`graph.inspector.film.hint.${kind}`) }}
    </p>

    <label>
      {{ t('graph.inspector.displayName') }}
      <input v-model="displayName" type="text" @change="persistTitle" />
    </label>

    <!-- 模型 -->
    <section v-if="kind !== 'shot'" class="group">
      <h3>{{ t('graph.inspector.film.models') }}</h3>
      <label class="row">
        <span>{{
          kind === 'breakdown' || kind === 'review'
            ? t('graph.inspector.film.textModel')
            : t('graph.inspector.film.imageModel')
        }}</span>
        <InstructionModelSelect
          v-model="primaryModelKey"
          :options="primaryOptions"
          :title="t('graph.inspector.film.models')"
          :empty-label="t('graph.inspector.film.noModel')"
          @change="persistModel('primary')"
        />
      </label>
      <template v-if="kind === 'render'">
        <label v-if="params.filmRenderMode === 'video'" class="row">
          <span>{{ t('graph.inspector.film.videoModel') }}</span>
          <InstructionModelSelect
            v-model="videoModelKey"
            :options="videoOptions"
            :title="t('graph.inspector.film.videoModel')"
            :empty-label="t('graph.inspector.film.noModel')"
            @change="persistModel('video')"
          />
        </label>
        <label v-if="params.filmRenderQc" class="row">
          <span>{{ t('graph.inspector.film.qcModel') }}</span>
          <InstructionModelSelect
            v-model="qcModelKey"
            :options="textOptions"
            :title="t('graph.inspector.film.qcModel')"
            :empty-label="t('graph.inspector.film.noModel')"
            @change="persistModel('qc')"
          />
        </label>
      </template>
    </section>

    <!-- 分镜拆解 -->
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
            <option v-for="ratio in ASPECT_RATIOS" :key="ratio" :value="ratio">{{ ratio }}</option>
          </select>
        </label>
      </div>
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

    <!-- 导演审核 -->
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
      <p class="hint">
        {{ t('graph.inspector.film.maxRoundsHint') }}
      </p>
      <div
        v-if="params.filmReviewVerdict"
        class="verdict"
        :class="params.filmReviewVerdict === 'PASS' ? 'pass' : 'fail'"
      >
        {{ params.filmReviewVerdict }}
      </div>
      <pre v-if="params.filmReviewReport" class="report">{{ params.filmReviewReport }}</pre>
    </section>

    <!-- 角色场景设定 -->
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
      <label class="check">
        <input
          type="checkbox"
          :checked="params.filmForce === true"
          @change="patchBool('filmForce', $event)"
        />
        {{ t('graph.inspector.film.force') }}
      </label>
      <ul v-if="castEntries.length" class="entries">
        <li v-for="entry in castEntries" :key="entry.id">
          <span class="badge">{{ t(`graph.inspector.film.kind.${entry.kind}`) }}</span>
          <span class="name">{{ entry.name }}</span>
          <span class="state" :class="{ ok: !!(entry.imageRelativePath || entry.imageUrl) }">
            {{ entry.imageRelativePath || entry.imageUrl ? '✓' : '—' }}
          </span>
          <button
            type="button"
            class="lock"
            :class="{ on: entry.locked }"
            :title="t('graph.inspector.film.lockHint')"
            @click="toggleCastLock(entry.id)"
          >
            {{ entry.locked ? '🔒' : '🔓' }}
          </button>
        </li>
      </ul>
      <p class="hint">
        {{ t('graph.inspector.film.castRefHint') }}
      </p>
    </section>

    <!-- 镜头装配 -->
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
      <p class="hint">
        {{ t('graph.inspector.film.shotRefHint') }}
      </p>
    </section>

    <!-- 批量拍摄 -->
    <section v-if="kind === 'render'" class="group">
      <h3>{{ t('graph.inspector.film.renderOptions') }}</h3>
      <div class="segmented">
        <button
          v-for="mode in RENDER_MODES"
          :key="mode"
          type="button"
          :class="{ active: (params.filmRenderMode ?? 'keyframe') === mode }"
          @click="patchParams({ filmRenderMode: mode })"
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
            <option v-for="ratio in ASPECT_RATIOS" :key="ratio" :value="ratio">{{ ratio }}</option>
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
      <p class="hint">
        {{ t('graph.inspector.film.renderCacheHint') }}
      </p>
    </section>

    <!-- 额外指令 -->
    <section v-if="kind !== 'shot'" class="group">
      <h3>{{ t(`graph.inspector.film.instruction.${kind}`) }}</h3>
      <textarea
        rows="3"
        :value="params.generateInstruction ?? ''"
        :placeholder="t(`graph.inspector.film.instructionPlaceholder.${kind}`)"
        @change="patchString('generateInstruction', $event)"
      />
    </section>

    <!-- 分镜表（拆解 / 审核）：锁定与逐镜修改 -->
    <section v-if="storyboard && (kind === 'breakdown' || kind === 'review')" class="group">
      <h3>
        {{ t('graph.inspector.film.shots', { n: storyboard.shots.length }) }}
      </h3>
      <p class="hint">
        {{ t('graph.inspector.film.shotsHint') }}
      </p>
      <ol class="shots">
        <li
          v-for="shot in storyboard.shots"
          :key="shot.id"
          :class="{ fail: shot.review?.verdict === 'fail', locked: isLocked(shot) }"
        >
          <div class="shot-head" @click="toggleExpand(shot.id)">
            <span class="sid">{{ shot.id }}</span>
            <span class="meta"
              >{{ [shot.shotSize, shot.cameraMove].filter(Boolean).join(' · ') }} ·
              {{ shot.durationSec }}s</span
            >
            <span class="action">{{ shot.title || shot.action }}</span>
            <button
              type="button"
              class="lock"
              :class="{ on: isLocked(shot) }"
              :title="t('graph.inspector.film.lockHint')"
              @click.stop="toggleShotLock(shot.id)"
            >
              {{ isLocked(shot) ? '🔒' : '🔓' }}
            </button>
          </div>
          <p v-if="shot.review?.verdict === 'fail' && shot.review.notes" class="review-note">
            ⚠ {{ shot.review.notes }}
          </p>
          <div v-if="expanded === shot.id" class="shot-edit">
            <label>
              {{ t('graph.inspector.film.field.action') }}
              <textarea
                rows="2"
                :value="shot.action"
                @change="patchShot(shot.id, 'action', $event)"
              />
            </label>
            <label>
              {{ t('graph.inspector.film.field.imagePrompt') }}
              <textarea
                rows="3"
                :value="shot.imagePrompt"
                @change="patchShot(shot.id, 'imagePrompt', $event)"
              />
            </label>
            <label>
              {{ t('graph.inspector.film.field.videoPrompt') }}
              <textarea
                rows="3"
                :value="shot.videoPrompt"
                @change="patchShot(shot.id, 'videoPrompt', $event)"
              />
            </label>
          </div>
        </li>
      </ol>
    </section>

    <GraphNodeRunControl
      v-if="hasInPort"
      :status="runStatus"
      :is-running="isGraphRunning"
      :blocked="blocked"
      @toggle="toggleRun"
    />

    <section class="output-section">
      <h3>{{ t('graph.inspector.outputPreview') }}</h3>
      <GraphNodeOutputPreview v-if="hostId" :node="node" :host-id="hostId" />
      <GraphNodeOutputPreview
        v-if="hostId && kind === 'cast'"
        :node="node"
        :host-id="hostId"
        port-id="out-sheets"
      />
      <GraphNodeOutputPreview
        v-if="hostId && kind === 'render'"
        :node="node"
        :host-id="hostId"
        port-id="out-images"
      />
      <GraphNodeOutputPreview
        v-if="hostId && kind === 'render'"
        :node="node"
        :host-id="hostId"
        port-id="out-videos"
      />
    </section>
  </div>
  <div v-else class="node-inspector empty">
    {{ t('graph.inspector.node.empty') }}
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  isFilmNodeTypeId,
  isFilmShotLocked,
  parseFilmCast,
  parseFilmStoryboard,
  stringifyFilmCast,
  stringifyFilmStoryboard,
  type FilmEntityKind,
  type FilmShot,
  type GraphNode,
  type GraphNodeParams
} from '@shared/graph'
import GraphNodeRunControl from './GraphNodeRunControl.vue'
import GraphNodeOutputPreview from './GraphNodeOutputPreview.vue'
import InstructionModelSelect from './InstructionModelSelect.vue'
import { useStudioI18n } from '../composables/useStudioI18n'
import { useNodeDisplayTitle } from '../composables/useNodeDisplayTitle'
import { useGraphNodeRun } from '../composables/useGraphNodeRun'
import { useEditorKernel } from '../editor/kernel'
import { graphEditorHosts } from '../features/graph/model/graphEditorHosts'
import {
  invalidateGenerateModelSettingsCache,
  loadGenerateModelOptions,
  parseModelKey,
  preferredModelKey,
  type GenerateModelModality,
  type GenerateModelOption
} from '../features/graph/model/generateModelOptions'

type FilmKind = 'breakdown' | 'review' | 'cast' | 'shot' | 'render'

const ASPECT_RATIOS = ['16:9', '9:16', '2.39:1', '4:3', '1:1', '3:4']
const CAST_KINDS: FilmEntityKind[] = ['character', 'location', 'prop']
const RENDER_MODES = ['keyframe', 'video'] as const

const { t, graphTypeLabel } = useStudioI18n()
const editor = useEditorKernel()

const node = computed((): GraphNode | null => {
  void graphEditorHosts.revision.value
  const selection = editor.selection.current.value
  const id = selection.kind === 'graph.node' ? selection.id : null
  if (!id) return null
  const current = graphEditorHosts.getNode(selection.hostId, id)
  return current && isFilmNodeTypeId(current.typeId) ? current : null
})

const hostId = computed(() => {
  const selection = editor.selection.current.value
  return selection.kind === 'graph.node' ? (selection.hostId ?? '') : ''
})

const kind = computed(
  (): FilmKind => (node.value?.typeId?.slice('film.'.length) ?? 'breakdown') as FilmKind
)
const params = computed((): GraphNodeParams => node.value?.params ?? {})
const typeLabel = computed(() => (node.value?.typeId ? graphTypeLabel(node.value.typeId) : ''))
const displayTitle = useNodeDisplayTitle(node, typeLabel)
const { hasInPort, runStatus, isGraphRunning, blocked, toggleRun } = useGraphNodeRun(node)

function patchParams(patch: Partial<GraphNodeParams>): void {
  const current = node.value
  if (!current || !hostId.value) return
  graphEditorHosts.updateNode(hostId.value, current.id, patch)
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

// ─── 显示名 ───
const displayName = ref('')
watch(
  node,
  (current) => {
    displayName.value = current?.title?.trim() || ''
  },
  { immediate: true }
)
function persistTitle(): void {
  const current = node.value
  if (!current || !hostId.value) return
  graphEditorHosts.updateNode(hostId.value, current.id, {}, displayName.value)
  graphEditorHosts.bumpRevision()
}

// ─── 模型 ───
const primaryOptions = ref<GenerateModelOption[]>([])
const videoOptions = ref<GenerateModelOption[]>([])
const textOptions = ref<GenerateModelOption[]>([])
const primaryModelKey = ref('')
const videoModelKey = ref('')
const qcModelKey = ref('')
const loadedKey = ref('')

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
  const primaryModality: GenerateModelModality =
    kind.value === 'breakdown' || kind.value === 'review' ? 'text' : 'image'
  const primary = await loadOptions(
    primaryModality,
    preferredModelKey(p.generateProviderInstanceId, p.generateModel)
  )
  primaryOptions.value = primary.options
  primaryModelKey.value = primary.selectedKey
  if (kind.value === 'render') {
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
  if (which === 'primary')
    patchParams({ generateModel: model, generateProviderInstanceId: providerInstanceId })
  else if (which === 'video')
    patchParams({ filmVideoModel: model, filmVideoProviderInstanceId: providerInstanceId })
  else patchParams({ filmQcModel: model, filmQcProviderInstanceId: providerInstanceId })
}

watch(
  node,
  (current) => {
    if (!current) return
    const key = `${hostId.value}:${current.id}`
    if (key === loadedKey.value) return
    loadedKey.value = key
    expanded.value = ''
    void loadModels(current)
  },
  { immediate: true }
)

// ─── 分镜表 ───
const storyboard = computed(() => parseFilmStoryboard(params.value.filmStoryboard ?? ''))
const expanded = ref('')

function isLocked(shot: FilmShot): boolean {
  return isFilmShotLocked(shot)
}

function toggleExpand(id: string): void {
  expanded.value = expanded.value === id ? '' : id
}

function writeStoryboard(mutate: (shots: FilmShot[]) => FilmShot[]): void {
  const doc = storyboard.value
  if (!doc) return
  patchParams({ filmStoryboard: stringifyFilmStoryboard({ ...doc, shots: mutate(doc.shots) }) })
}

/** 锁定 = 人工确认：AI 重新拆解 / 审核修订都不会改写该镜 */
function toggleShotLock(id: string): void {
  writeStoryboard((shots) =>
    shots.map((shot) => {
      if (shot.id !== id) return shot
      const locked = !isFilmShotLocked(shot)
      return { ...shot, locked, status: locked ? 'approved' : 'draft' }
    })
  )
}

/** 人工改过的镜头自动锁定：之后重新拆解 / 审核修订都不会冲掉人工修改 */
function patchShot(
  id: string,
  field: 'action' | 'imagePrompt' | 'videoPrompt',
  event: Event
): void {
  const value = inputValue(event).trim()
  writeStoryboard((shots) =>
    shots.map((shot) =>
      shot.id === id ? { ...shot, [field]: value, locked: true, status: 'approved' as const } : shot
    )
  )
}

// ─── 设定库 ───
const castKinds = computed((): FilmEntityKind[] => {
  const raw = params.value.filmCastKinds ?? 'character,location'
  return CAST_KINDS.filter((k) =>
    raw
      .split(',')
      .map((s) => s.trim())
      .includes(k)
  )
})
const cast = computed(() => parseFilmCast(params.value.filmCast ?? ''))
const castEntries = computed(() => cast.value?.entries ?? [])

function toggleCastKind(castKind: FilmEntityKind): void {
  const next = castKinds.value.includes(castKind)
    ? castKinds.value.filter((k) => k !== castKind)
    : [...castKinds.value, castKind]
  patchParams({ filmCastKinds: (next.length ? next : ['character']).join(',') })
}

function toggleCastLock(id: string): void {
  const doc = cast.value
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

// ─── 镜头选择 ───
function stepShot(delta: number): void {
  const raw = String(params.value.filmShotRef ?? '1').trim()
  const n = parseInt(raw, 10)
  const next = Number.isFinite(n) && String(n) === raw ? Math.max(1, n + delta) : 1
  patchParams({ filmShotRef: String(next) })
}
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
.head h2 {
  margin: 0;
  font-size: 14px;
}
.hint {
  margin: 0;
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.45;
}
label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--text-muted);
}
label.row {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
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
  border-radius: 4px;
  padding: 6px 8px;
  font-size: 12px;
  font-family: inherit;
}
label.inline input {
  width: 64px;
}
textarea {
  resize: vertical;
  line-height: 1.4;
}
.group {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--border);
}
.group h3,
.output-section h3 {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
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
.lock {
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text);
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  padding: 2px 8px;
}
.lock.on {
  border-color: var(--accent);
}
.verdict {
  align-self: flex-start;
  padding: 2px 10px;
  border-radius: 10px;
  font-size: 12px;
  font-weight: 700;
}
.verdict.pass {
  background: color-mix(in srgb, #2e9e5b 22%, transparent);
  color: #2e9e5b;
}
.verdict.fail {
  background: color-mix(in srgb, #d0583a 22%, transparent);
  color: #d0583a;
}
.report {
  margin: 0;
  padding: 8px;
  max-height: 220px;
  overflow: auto;
  white-space: pre-wrap;
  font-size: 11px;
  line-height: 1.45;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 4px;
}
.entries,
.shots {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.entries li {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}
.entries .name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.badge {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 8px;
  border: 1px solid var(--border);
  color: var(--text-muted);
}
.state {
  color: var(--text-muted);
}
.state.ok {
  color: #2e9e5b;
}
.shots li {
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.shots li.fail {
  border-color: #d0583a;
}
.shots li.locked {
  border-color: color-mix(in srgb, var(--accent) 60%, var(--border));
}
.shot-head {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  cursor: pointer;
}
.sid {
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.meta {
  color: var(--text-muted);
  font-size: 11px;
  white-space: nowrap;
}
.action {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.review-note {
  margin: 0;
  font-size: 11px;
  color: #d0583a;
}
.shot-edit {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.output-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
}
</style>
