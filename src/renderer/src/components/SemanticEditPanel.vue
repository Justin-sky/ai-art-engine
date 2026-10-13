<template>
  <section class="sep">
    <header class="sep-head">
      <h3 class="sep-title">{{ t('graph.semanticEdit.title') }}</h3>
      <span class="sep-summary">{{
        t('graph.semanticEdit.summary', {
          shots: summary.dirtyShots,
          removed: summary.removedShots,
          lines: summary.dirtyDialogue
        })
      }}</span>
      <div class="sep-tabs" role="tablist">
        <button
          v-for="tab in tabs"
          :key="tab"
          type="button"
          role="tab"
          class="sep-tab"
          :aria-selected="active === tab"
          :class="{ on: active === tab }"
          @click="active = tab"
        >
          {{ t(`graph.semanticEdit.tab_${tab}`) }}
        </button>
      </div>
    </header>
    <p class="sep-hint">{{ t('graph.semanticEdit.hint') }}</p>
    <p v-if="error" class="sep-err">{{ error }}</p>

    <!-- 镜头：镜头语言 / 画面 / 主体动作 / 提示词覆盖 / 删除 -->
    <div v-if="active === 'shots'" class="sep-list">
      <p v-if="!shots.length" class="sep-hint">{{ t('graph.semanticEdit.noShots') }}</p>
      <article
        v-for="(shot, index) in shots"
        :key="shot.id"
        class="sep-card"
        :class="{ removed: shot.removed, dirty: dirtyShots.has(shot.id) }"
      >
        <div class="sep-card-head">
          <span class="sep-id">S{{ index + 1 }}</span>
          <span class="sep-time">{{ fmt(shot.range.start) }}–{{ fmt(shot.range.end) }}s</span>
          <span v-if="shot.removed" class="sep-chip warn">{{
            t('graph.semanticEdit.removed')
          }}</span>
          <span v-else-if="dirtyShots.has(shot.id)" class="sep-chip on">
            {{ t('graph.semanticEdit.willRegenerate') }}
          </span>
          <span v-else class="sep-chip">{{ t('graph.semanticEdit.passthrough') }}</span>
          <button
            type="button"
            class="sep-btn"
            @click="
              emitEdit({ op: shot.removed ? 'shot.restore' : 'shot.remove', target: shot.id })
            "
          >
            {{ shot.removed ? t('graph.semanticEdit.restore') : t('graph.semanticEdit.remove') }}
          </button>
        </div>

        <template v-if="!shot.removed">
          <div v-for="(sub, si) in shot.subjects" :key="`${shot.id}-sub-${si}`" class="sep-row">
            <label class="sep-field">
              <span>{{ t('graph.semanticEdit.subject') }}</span>
              <input
                :value="sub.name"
                :disabled="!!sub.entityId"
                :title="sub.entityId ? t('graph.semanticEdit.subjectBoundHint') : ''"
                @change="updateSubject(shot, si, { name: valueOf($event) })"
              />
            </label>
            <label class="sep-field grow">
              <span>{{ t('graph.semanticEdit.action') }}</span>
              <input
                :value="sub.action ?? ''"
                @change="updateSubject(shot, si, { action: valueOf($event) })"
              />
            </label>
          </div>
          <button type="button" class="sep-link" @click="addSubject(shot)">
            {{ t('graph.semanticEdit.addSubject') }}
          </button>

          <div class="sep-grid">
            <label v-for="key in cameraKeys" :key="`${shot.id}-cam-${key}`" class="sep-field">
              <span>{{ t(`graph.semanticEdit.camera_${key}`) }}</span>
              <input
                :value="shot.camera?.[key] ?? ''"
                @change="updateGroup(shot, 'camera', key, valueOf($event))"
              />
            </label>
            <label v-for="key in visualKeys" :key="`${shot.id}-vis-${key}`" class="sep-field">
              <span>{{ t(`graph.semanticEdit.visual_${key}`) }}</span>
              <input
                :value="shot.visual?.[key] ?? ''"
                @change="updateGroup(shot, 'visual', key, valueOf($event))"
              />
            </label>
          </div>
          <p v-if="!shot.promptOverride?.trim() && promptByShot?.[shot.id]" class="sep-prompt">
            <span class="sep-prompt-label">{{ t('graph.semanticEdit.currentPrompt') }}</span>
            {{ promptByShot[shot.id] }}
          </p>
          <label class="sep-field">
            <span>{{ t('graph.semanticEdit.promptOverride') }}</span>
            <textarea
              :value="shot.promptOverride ?? ''"
              rows="2"
              spellcheck="false"
              :placeholder="t('graph.semanticEdit.promptOverridePlaceholder')"
              @change="
                emitEdit({ op: 'shot.prompt', target: shot.id, patch: { prompt: valueOf($event) } })
              "
            />
          </label>
        </template>
      </article>
    </div>

    <!-- 台词：改文本 = 重建时重新配音（画面不动） -->
    <div v-else-if="active === 'dialogue'" class="sep-list">
      <p v-if="!lines.length" class="sep-hint">{{ t('graph.semanticEdit.noDialogue') }}</p>
      <article
        v-for="line in lines"
        :key="line.id"
        class="sep-card"
        :class="{ dirty: dirtyLines.has(line.id) }"
      >
        <div class="sep-card-head">
          <span class="sep-time">{{ fmt(line.range.start) }}–{{ fmt(line.range.end) }}s</span>
          <span v-if="dirtyLines.has(line.id)" class="sep-chip on">
            {{ t('graph.semanticEdit.willRedub') }}
          </span>
          <span v-if="dirtyLines.has(line.id)" class="sep-source">
            {{ t('graph.semanticEdit.original') }}{{ line.sourceText }}
          </span>
        </div>
        <div class="sep-row">
          <label class="sep-field grow">
            <span>{{ t('graph.semanticEdit.lineText') }}</span>
            <input
              :value="line.text"
              @change="
                emitEdit({
                  op: 'dialogue.update',
                  target: line.id,
                  patch: { text: valueOf($event) }
                })
              "
            />
          </label>
          <label class="sep-field">
            <span>{{ t('graph.semanticEdit.speaker') }}</span>
            <input
              :value="line.speaker ?? ''"
              @change="
                emitEdit({
                  op: 'dialogue.update',
                  target: line.id,
                  patch: { speaker: valueOf($event) }
                })
              "
            />
          </label>
        </div>
      </article>
    </div>

    <!-- 实体：改名 / 换参考资产 → 它出现的镜头都重新生成 -->
    <div v-else class="sep-list">
      <p v-if="!entities.length" class="sep-hint">{{ t('graph.semanticEdit.noEntities') }}</p>
      <article v-for="ent in entities" :key="ent.id" class="sep-card">
        <div class="sep-card-head">
          <span class="sep-id">{{ ent.kind }}</span>
          <span class="sep-time">{{
            t('graph.semanticEdit.appearances', { n: ent.appearances?.length ?? 0 })
          }}</span>
        </div>
        <div class="sep-row">
          <label class="sep-field grow">
            <span>{{ t('graph.semanticEdit.entityName') }}</span>
            <input
              :value="ent.name"
              @change="
                emitEdit({ op: 'entity.update', target: ent.id, patch: { name: valueOf($event) } })
              "
            />
          </label>
          <label class="sep-field grow">
            <span>{{ t('graph.semanticEdit.entityReference') }}</span>
            <input
              :value="ent.reference?.assetId ?? ''"
              :placeholder="t('graph.semanticEdit.entityReferencePlaceholder')"
              @change="
                emitEdit({
                  op: 'entity.update',
                  target: ent.id,
                  patch: { referenceAssetId: valueOf($event) }
                })
              "
            />
          </label>
        </div>
      </article>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  diffAgainstBaseline,
  type SemanticEditInput,
  type SemanticShot,
  type SemanticTimeline,
  type ShotCamera,
  type ShotSubject,
  type ShotVisual
} from '@shared/semanticTimeline'
import { useStudioI18n } from '../composables/useStudioI18n'

/**
 * 结构化修改面板（dive 里，时间线编辑器下方）。
 *
 * 这是"逆向视频工程"里的**修改**一步：分析出的镜头树 / 台词 / 实体就地改，
 * 面板只 emit 修改操作（`applySemanticEdit` 的输入），由 dive 视图应用并落盘 ——
 * 文档仍是唯一事实来源，编译节点据基线判断哪些镜头要重新生成、哪些台词要重新配音。
 */
const props = defineProps<{
  timeline: SemanticTimeline
  /** shotId → 按当前内容会生成的提示词（只读参照；覆盖框为空时就用它） */
  promptByShot?: Record<string, string>
  error?: string
}>()

const emit = defineEmits<{ edit: [input: SemanticEditInput] }>()

const { t } = useStudioI18n()

const tabs = ['shots', 'dialogue', 'entities'] as const
const active = ref<(typeof tabs)[number]>('shots')

const cameraKeys = ['shotSize', 'angle', 'motion', 'lens'] as const satisfies ReadonlyArray<
  keyof ShotCamera
>
const visualKeys = ['description', 'style', 'lighting', 'grade'] as const satisfies ReadonlyArray<
  keyof ShotVisual
>

const shots = computed(() => props.timeline.shots ?? [])
const lines = computed(() => props.timeline.dialogue ?? [])
const entities = computed(() => (props.timeline.entities ?? []).filter((e) => e.kind !== 'voice'))
const diff = computed(() => diffAgainstBaseline(props.timeline))
const dirtyShots = computed(() => new Set(diff.value.dirtyShots.keys()))
const dirtyLines = computed(() => diff.value.dirtyDialogue)
const summary = computed(() => ({
  dirtyShots: diff.value.dirtyShots.size,
  removedShots: diff.value.removedShots.size,
  dirtyDialogue: diff.value.dirtyDialogue.size
}))

function fmt(sec: number): string {
  return Number.isFinite(sec) ? sec.toFixed(2) : '0.00'
}

function valueOf(e: Event): string {
  return (e.target as HTMLInputElement | HTMLTextAreaElement).value
}

function emitEdit(input: SemanticEditInput): void {
  emit('edit', input)
}

function updateGroup(
  shot: SemanticShot,
  group: 'camera' | 'visual',
  key: string,
  value: string
): void {
  const current = { ...(shot[group] ?? {}) } as Record<string, unknown>
  const trimmed = value.trim()
  if (trimmed) current[key] = trimmed
  else delete current[key]
  emitEdit({ op: 'shot.update', target: shot.id, patch: { [group]: current } })
}

function updateSubject(shot: SemanticShot, index: number, patch: Partial<ShotSubject>): void {
  const subjects = (shot.subjects ?? []).map((s, i) => {
    if (i !== index) return s
    const next = { ...s, ...patch }
    if (typeof patch.action === 'string' && !patch.action.trim()) delete next.action
    return next
  })
  emitEdit({ op: 'shot.update', target: shot.id, patch: { subjects } })
}

function addSubject(shot: SemanticShot): void {
  emitEdit({
    op: 'shot.update',
    target: shot.id,
    patch: { subjects: [...(shot.subjects ?? []), { name: t('graph.semanticEdit.newSubject') }] }
  })
}
</script>

<style scoped>
.sep {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-panel);
  flex: 0 0 auto;
}
.sep-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.sep-title {
  margin: 0;
  font-size: 13px;
}
.sep-summary {
  font-size: 12px;
  color: var(--text-muted);
}
.sep-tabs {
  margin-left: auto;
  display: flex;
  gap: 4px;
}
.sep-tab {
  padding: 2px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  font-size: 12px;
  cursor: pointer;
}
.sep-tab.on {
  color: var(--text);
  border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
  background: color-mix(in srgb, var(--accent) 14%, transparent);
}
.sep-hint {
  margin: 0;
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.5;
}
.sep-err {
  margin: 0;
  font-size: 12px;
  color: #f88;
}
.sep-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 420px;
  overflow: auto;
}
.sep-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-elevated);
}
.sep-card.dirty {
  border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
}
.sep-card.removed {
  opacity: 0.6;
}
.sep-card-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.sep-id {
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  color: var(--text-muted);
}
.sep-time {
  font-size: 11px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}
.sep-source {
  font-size: 11px;
  color: var(--text-muted);
}
.sep-chip {
  padding: 0 6px;
  border-radius: 999px;
  background: var(--bg-panel);
  color: var(--text-muted);
  font-size: 11px;
}
.sep-chip.on {
  color: var(--text);
  background: color-mix(in srgb, var(--accent) 22%, transparent);
}
.sep-chip.warn {
  background: color-mix(in srgb, #e0a458 26%, transparent);
}
.sep-btn {
  margin-left: auto;
  padding: 1px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  font-size: 11px;
  cursor: pointer;
}
.sep-btn:hover,
.sep-link:hover {
  color: var(--text);
}
.sep-link {
  align-self: flex-start;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--text-muted);
  font-size: 11px;
  cursor: pointer;
  text-decoration: underline;
}
.sep-row {
  display: flex;
  gap: 6px;
}
.sep-prompt {
  margin: 0;
  padding: 4px 6px;
  border-radius: 6px;
  background: var(--bg-panel);
  font-size: 12px;
  line-height: 1.5;
  color: var(--text);
  word-break: break-word;
}
.sep-prompt-label {
  margin-right: 6px;
  color: var(--text-muted);
  font-size: 11px;
}
.sep-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px;
}
.sep-field {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 11px;
  color: var(--text-muted);
  min-width: 0;
}
.sep-field.grow {
  flex: 1 1 auto;
}
.sep-field input,
.sep-field textarea {
  font: inherit;
  font-size: 12px;
  padding: 4px 6px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-panel);
  color: var(--text);
  min-width: 0;
}
.sep-field textarea {
  resize: vertical;
}
.sep-field input:focus-visible,
.sep-field textarea:focus-visible,
.sep-tab:focus-visible,
.sep-btn:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
</style>
