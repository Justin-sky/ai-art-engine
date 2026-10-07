<template>
  <StudioFloatingWindow
    :open="open"
    :title="t('workflowExport.dialog.title')"
    :subtitle="t('workflowExport.dialog.subtitle')"
    :show-close="false"
    :z-index="zIndex"
    :default-width="560"
    :default-height="620"
    body-class="pad-none"
    @close="onClose"
  >
    <div class="wx-body">
      <!-- 成功面板：结果 + 下一步（不自动关窗，下一步要照着做） -->
      <template v-if="done">
        <p class="wx-ok">{{ t('workflowExport.dialog.done', { dir: done.dir ?? '' }) }}</p>

        <section v-if="notes.length" class="wx-section">
          <h4>{{ t('workflowExport.dialog.warnings') }}</h4>
          <ul>
            <li v-for="(note, index) in notes" :key="`${note.reasonKey}:${index}`">
              {{ warningText(note) }}
            </li>
          </ul>
        </section>

        <section class="wx-section">
          <h4>{{ t('workflowExport.dialog.nextSteps') }}</h4>
          <ul>
            <li v-for="(note, index) in done.nextSteps" :key="`${note.reasonKey}:${index}`">
              {{ nextStepText(note) }}
            </li>
          </ul>
        </section>
      </template>

      <template v-else>
        <div class="form">
          <label class="field">
            <span class="field-label">{{ t('workflowExport.dialog.id') }}</span>
            <input v-model="id" :class="{ bad: errorField === 'id' }" :disabled="busy" />
            <span class="hint">{{ t('workflowExport.dialog.idHint') }}</span>
          </label>

          <label class="field">
            <span class="field-label">{{ t('workflowExport.dialog.titleField') }}</span>
            <input v-model="title" :class="{ bad: errorField === 'title' }" :disabled="busy" />
          </label>

          <label class="field">
            <span class="field-label">{{ t('workflowExport.dialog.titleEn') }}</span>
            <input v-model="titleEn" :disabled="busy" />
          </label>

          <label class="field">
            <span class="field-label">{{ t('workflowExport.dialog.summary') }}</span>
            <input v-model="summary" :class="{ bad: errorField === 'summary' }" :disabled="busy" />
            <span class="hint">
              {{ t('workflowExport.dialog.summaryHint', { max: SUMMARY_MAX }) }}
            </span>
          </label>

          <label class="field">
            <span class="field-label">{{ t('workflowExport.dialog.category') }}</span>
            <select v-model="category" :disabled="busy">
              <option v-for="item in categories" :key="item" :value="item">
                {{ t(workflowCategoryKey(item)) }}
              </option>
            </select>
          </label>

          <label class="field">
            <span class="field-label">{{ t('workflowExport.dialog.tags') }}</span>
            <input v-model="tags" :disabled="busy" />
            <span class="hint">{{ t('workflowExport.dialog.tagsHint') }}</span>
          </label>

          <div class="row">
            <label class="field grow">
              <span class="field-label">{{ t('workflowExport.dialog.version') }}</span>
              <input
                v-model="version"
                :class="{ bad: errorField === 'version' }"
                :disabled="busy"
              />
            </label>
            <label class="field grow">
              <span class="field-label">{{ t('workflowExport.dialog.license') }}</span>
              <input
                v-model="license"
                :class="{ bad: errorField === 'license' }"
                :disabled="busy"
              />
            </label>
          </div>

          <div class="row">
            <label class="field grow">
              <span class="field-label">{{ t('workflowExport.dialog.authorName') }}</span>
              <input
                v-model="authorName"
                :class="{ bad: errorField === 'author' }"
                :disabled="busy"
              />
            </label>
            <label class="field grow">
              <span class="field-label">{{ t('workflowExport.dialog.authorUrl') }}</span>
              <input v-model="authorUrl" :disabled="busy" />
            </label>
          </div>

          <div class="field">
            <span class="field-label">{{ t('workflowExport.dialog.cover') }}</span>
            <div class="row">
              <button type="button" :disabled="busy" @click="void pickCover()">
                {{ t('workflowExport.dialog.chooseCover') }}
              </button>
              <span class="cover-name">{{
                coverFileName || t('workflowExport.dialog.coverEmpty')
              }}</span>
            </div>
            <span class="hint" :class="{ 'hint-bad': errorField === 'cover' }">
              {{ t('workflowExport.dialog.coverHint') }}
            </span>
          </div>
        </div>

        <p v-if="error" class="err">{{ noteText(error) }}</p>

        <section v-if="notes.length" class="wx-section">
          <h4>{{ t('workflowExport.dialog.warnings') }}</h4>
          <ul>
            <li v-for="(note, index) in notes" :key="`${note.reasonKey}:${index}`">
              {{ warningText(note) }}
            </li>
          </ul>
        </section>
      </template>
    </div>

    <template #footer>
      <template v-if="done">
        <button type="button" class="primary" @click="onClose">
          {{ t('workflowExport.dialog.close') }}
        </button>
      </template>
      <template v-else>
        <button type="button" :disabled="busy" @click="onClose">
          {{ t('common.cancel') }}
        </button>
        <!-- 同名目录已存在：覆盖必须是**这一次的显式选择**，不能靠上一次的勾选残留 -->
        <button
          v-if="canOverwrite"
          type="button"
          class="danger"
          :disabled="busy"
          @click="onExport(true)"
        >
          {{ t('workflowExport.dialog.overwrite') }}
        </button>
        <button v-else type="button" class="primary" :disabled="busy" @click="onExport(false)">
          {{ busy ? t('workflowExport.dialog.exporting') : t('workflowExport.dialog.export') }}
        </button>
      </template>
    </template>
  </StudioFloatingWindow>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useStudioI18n } from '../composables/useStudioI18n'
import {
  WORKFLOW_EXPORT_LIMITS,
  normalizeWorkflowExportMeta,
  type WorkflowExportMetaInput,
  type WorkflowExportNote
} from '@shared/workflowExport'
import { WORKFLOW_MARKET_CATEGORIES, workflowCategoryKey } from '@shared/workflowMarket'
import StudioFloatingWindow from './StudioFloatingWindow.vue'

/**
 * 「导出为市场工作流」的元数据表单。
 *
 * 校验用的是共享层的 `normalizeWorkflowExportMeta`（主进程同一条路径），所以「界面上能过、
 * 主进程却拒」这类分裂不会发生；失败原因一律按 `reasonKey` 出文案，主进程不产出成品句子。
 *
 * 目录选择在**主进程**弹（`dialogService`）：界面只提供标题，不接触路径拼接与写盘。
 */
const props = withDefaults(
  defineProps<{
    open: boolean
    assetId: string
    /** 预填标题（通常是资产名 / 图标题） */
    defaultTitle?: string
    /**
     * 调用前的落盘钩子：主进程读的是**落盘图**（与 MCP `graph_read` 同一份），
     * 所以导出前必须把画布当前状态写完。
     */
    prepare?: () => Promise<void>
    zIndex?: number
  }>(),
  { defaultTitle: '', prepare: undefined, zIndex: 2050 }
)

const emit = defineEmits<{ close: [] }>()

const { t } = useStudioI18n()

const SUMMARY_MAX = WORKFLOW_EXPORT_LIMITS.summaryMax
const categories = WORKFLOW_MARKET_CATEGORIES

const id = ref('')
const title = ref('')
const titleEn = ref('')
const summary = ref('')
const category = ref<string>(WORKFLOW_MARKET_CATEGORIES[0])
const tags = ref('')
const version = ref('0.1.0')
const authorName = ref('')
const authorUrl = ref('')
const license = ref('CC-BY-4.0')
const coverPath = ref('')

const busy = ref(false)
const attempted = ref(false)
const error = ref<WorkflowExportNote | null>(null)
const done = ref<{
  dir?: string
  warnings: WorkflowExportNote[]
  nextSteps: WorkflowExportNote[]
} | null>(null)
const lastWarnings = ref<WorkflowExportNote[]>([])
const canOverwrite = ref(false)

const draft = computed<WorkflowExportMetaInput>(() => ({
  id: id.value,
  title: title.value,
  titleEn: titleEn.value,
  summary: summary.value,
  category: category.value,
  // 全角标点在这里归一：共享层的拆分只认 ASCII 逗号与空白
  tags: tags.value.replace(/[\uFF0C\u3001]/g, ','),
  version: version.value,
  authorName: authorName.value,
  authorUrl: authorUrl.value,
  license: license.value
}))

const validation = computed(() => normalizeWorkflowExportMeta(draft.value))

const coverFileName = computed(() => {
  const parts = coverPath.value.split(/[\\/]/)
  return parts[parts.length - 1] ?? ''
})

/** 失败原因落在哪个字段上（只用于给输入框标红） */
const errorField = computed(() => {
  if (!attempted.value) return ''
  if (!coverPath.value) return 'cover'
  const result = validation.value
  if (result.ok) return ''
  switch (result.reasonKey) {
    case 'idRequired':
    case 'idFormat':
    case 'idTooLong':
    case 'idPresetReserved':
      return 'id'
    case 'titleRequired':
      return 'title'
    case 'summaryRequired':
    case 'summaryTooLong':
      return 'summary'
    case 'categoryInvalid':
      return 'category'
    case 'versionInvalid':
      return 'version'
    case 'authorRequired':
      return 'author'
    case 'licenseRequired':
      return 'license'
    default:
      return ''
  }
})

const notes = computed(() => (done.value ? done.value.warnings : lastWarnings.value))

watch(
  () => props.open,
  (visible) => {
    if (!visible) return
    id.value = ''
    title.value = props.defaultTitle ?? ''
    titleEn.value = ''
    summary.value = ''
    category.value = WORKFLOW_MARKET_CATEGORIES[0]
    tags.value = ''
    version.value = '0.1.0'
    authorName.value = ''
    authorUrl.value = ''
    license.value = 'CC-BY-4.0'
    coverPath.value = ''
    busy.value = false
    attempted.value = false
    error.value = null
    done.value = null
    lastWarnings.value = []
    canOverwrite.value = false
  }
)

/** reasonKey → 文案（渲染层拼键：主进程与共享层只给键） */
function noteText(note: WorkflowExportNote): string {
  return t(`workflowExport.reason.${note.reasonKey}`, note.params ?? {})
}

function warningText(note: WorkflowExportNote): string {
  return t(`workflowExport.warn.${note.reasonKey}`, note.params ?? {})
}

function nextStepText(note: WorkflowExportNote): string {
  return t(`workflowExport.nextStep.${note.reasonKey}`, note.params ?? {})
}

async function pickCover(): Promise<void> {
  const files = await window.studio.selectFiles([{ name: 'PNG', extensions: ['png'] }])
  const first = files.find((file) => file.trim())
  if (first) {
    coverPath.value = first
    if (error.value?.reasonKey.startsWith('cover')) error.value = null
  }
}

async function onExport(overwrite: boolean): Promise<void> {
  if (busy.value) return
  attempted.value = true
  canOverwrite.value = false

  const result = validation.value
  if (!result.ok) {
    error.value = { reasonKey: result.reasonKey, params: result.params }
    return
  }
  if (!coverPath.value) {
    error.value = { reasonKey: 'coverRequired' }
    return
  }

  busy.value = true
  error.value = null
  lastWarnings.value = []
  try {
    // 先落盘再导出：主进程读的是磁盘上的图（与 graph_read 同一份）
    await props.prepare?.()
    const response = await window.studio.exportWorkflowToMarket({
      assetId: props.assetId,
      meta: draft.value,
      coverPath: coverPath.value,
      overwrite,
      directoryTitle: t('workflowExport.dialog.pickDirectoryTitle')
    })
    lastWarnings.value = response.warnings ?? []
    if (response.ok) {
      done.value = {
        dir: response.dir,
        warnings: response.warnings ?? [],
        nextSteps: response.nextSteps ?? []
      }
      return
    }
    // 用户在选择器里按了取消：静默回到表单，不当作错误
    if (response.reasonKey === 'canceled') return
    error.value = {
      reasonKey: response.reasonKey ?? 'unknown',
      params: response.reasonParams ?? {}
    }
    canOverwrite.value = response.reasonKey === 'targetExists'
  } catch (err) {
    error.value = {
      reasonKey: 'unknown',
      params: { message: err instanceof Error ? err.message : String(err) }
    }
  } finally {
    busy.value = false
  }
}

function onClose(): void {
  if (busy.value) return
  emit('close')
}
</script>

<style scoped>
.wx-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px 12px;
  overflow: auto;
}

.form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.row {
  display: flex;
  align-items: flex-end;
  gap: 8px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--text-muted);
}

.field.grow {
  flex: 1 1 0;
  min-width: 0;
}

.field-label {
  font-size: 12px;
  color: var(--text-muted);
}

.hint {
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.4;
}

.bad {
  border-color: var(--danger);
}

.hint-bad {
  color: var(--danger);
}

.cover-name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: var(--text);
}

.err {
  margin: 0;
  color: var(--danger);
  font-size: 12px;
  white-space: pre-wrap;
}

.wx-ok {
  margin: 0;
  font-size: 12px;
  color: var(--text);
  word-break: break-all;
}

.wx-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.wx-section h4 {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
}

.wx-section ul {
  margin: 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.wx-section li {
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.5;
}
</style>
