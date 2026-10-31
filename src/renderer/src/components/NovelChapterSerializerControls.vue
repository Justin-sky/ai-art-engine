<template>
  <div class="novel-serializer" @pointerdown.stop @click.stop @dblclick.stop @wheel.stop>
    <div class="novel-serializer-row">
      <span class="novel-badge">📚 {{ uiText.badge }}</span>

      <div class="novel-field-group">
        <span class="novel-lbl">{{ uiText.curChapPrefix }}</span>
        <button
          type="button"
          class="novel-step-btn"
          :disabled="currentChapter <= 1"
          :title="uiText.prevChapTip"
          @click="stepChapter(-1)"
        >
          ◀
        </button>
        <input
          type="number"
          class="novel-num-input is-chap"
          min="1"
          :max="totalChapters"
          :value="currentChapter"
          @change="onCurrentChapterChange"
        />
        <button
          type="button"
          class="novel-step-btn"
          :disabled="currentChapter >= totalChapters"
          :title="uiText.nextChapTip"
          @click="stepChapter(1)"
        >
          ▶
        </button>
        <span class="novel-lbl">/ {{ uiText.totalChapPrefix }}</span>
        <input
          type="number"
          class="novel-num-input is-total"
          min="1"
          max="5000"
          step="10"
          :value="totalChapters"
          :title="uiText.totalChapTip"
          @change="onTotalChaptersChange"
        />
        <span class="novel-lbl">{{ uiText.chapUnit }}</span>
      </div>

      <div class="novel-quick-totals">
        <button
          v-for="presetTotal in [80, 300, 800, 1500]"
          :key="presetTotal"
          type="button"
          class="novel-pill-btn"
          :class="{ 'is-active': totalChapters === presetTotal }"
          @click="setTotalChapters(presetTotal)"
        >
          {{ presetTotal }}{{ uiText.chapUnit }}
        </button>
      </div>

      <div class="novel-field-group">
        <span class="novel-lbl">{{ uiText.wordsLabel }}</span>
        <input
          type="number"
          class="novel-num-input is-words"
          min="1000"
          max="15000"
          step="200"
          :value="targetWords"
          @change="onTargetWordsChange"
        />
        <span class="novel-lbl">{{ uiText.wordsUnit }}</span>
      </div>

      <label class="novel-chk" :title="uiText.autoAdvanceTip">
        <input type="checkbox" :checked="autoAdvance" @change="onAutoAdvanceChange" />
        <span>{{ uiText.autoAdvanceLbl }}</span>
      </label>

      <button
        type="button"
        class="novel-memory-btn"
        :class="{ 'is-open': memoryOpen }"
        @click="memoryOpen = !memoryOpen"
      >
        🧠 {{ uiText.memoryBtn }} ({{ historyCount }}) {{ memoryOpen ? '▴' : '▾' }}
      </button>
    </div>

    <div v-if="memoryOpen" class="novel-memory-drawer">
      <div class="novel-memory-tabs">
        <button
          type="button"
          class="novel-mem-tab"
          :class="{ 'is-active': activeMemTab === 'ledger' }"
          @click="activeMemTab = 'ledger'"
        >
          {{ uiText.tabLedger }}
        </button>
        <button
          type="button"
          class="novel-mem-tab"
          :class="{ 'is-active': activeMemTab === 'bible' }"
          @click="activeMemTab = 'bible'"
        >
          {{ uiText.tabBible }}
        </button>
        <button
          type="button"
          class="novel-mem-tab"
          :class="{ 'is-active': activeMemTab === 'summary' }"
          @click="activeMemTab = 'summary'"
        >
          {{ uiText.tabSummary }}
        </button>
        <button
          type="button"
          class="novel-mem-tab"
          :class="{ 'is-active': activeMemTab === 'tail' }"
          @click="activeMemTab = 'tail'"
        >
          {{ uiText.tabTail }}
        </button>
        <button
          type="button"
          class="novel-mem-reset"
          :title="uiText.resetTip"
          @click="resetNovelProgress"
        >
          ↺ {{ uiText.resetBtn }}
        </button>
      </div>

      <textarea
        v-if="activeMemTab === 'ledger'"
        class="novel-mem-textarea"
        rows="4"
        :value="stateLedger"
        :placeholder="uiText.ledgerPlaceholder"
        @change="onLedgerChange"
      />
      <textarea
        v-else-if="activeMemTab === 'bible'"
        class="novel-mem-textarea"
        rows="4"
        :value="worldBible"
        :placeholder="uiText.biblePlaceholder"
        @change="onBibleChange"
      />
      <textarea
        v-else-if="activeMemTab === 'summary'"
        class="novel-mem-textarea"
        rows="4"
        :value="rollingSummary"
        :placeholder="uiText.summaryPlaceholder"
        @change="onSummaryChange"
      />
      <div v-else class="novel-tail-preview">
        <div class="novel-tail-meta">{{ prevTailMeta }}</div>
        <pre class="novel-tail-code">{{ prevTailAnchor || uiText.tailEmpty }}</pre>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { parseNovelChapterHistory } from '@shared/graph/execute/generateText'
import { graphEditorHosts } from '../features/graph/model/graphEditorHosts'
import { useStudioI18n } from '../composables/useStudioI18n'

const props = defineProps<{
  hostId: string
  nodeId: string
}>()

const { locale } = useStudioI18n()
const isZh = computed(
  () =>
    !String(locale.value ?? 'zh')
      .toLowerCase()
      .startsWith('en')
)
function L(zh: string, en: string): string {
  return isZh.value ? zh : en
}

const memoryOpen = ref(false)
const activeMemTab = ref<'ledger' | 'bible' | 'summary' | 'tail'>('ledger')

const node = computed(() => {
  void graphEditorHosts.revision.value
  return graphEditorHosts.getNode(props.hostId, props.nodeId)
})

const totalChapters = computed(() =>
  Math.max(1, Math.min(5000, Math.round(Number(node.value?.params?.novelTotalChapters) || 800)))
)
const currentChapter = computed(() =>
  Math.max(
    1,
    Math.min(totalChapters.value, Math.round(Number(node.value?.params?.novelCurrentChapter) || 1))
  )
)
const targetWords = computed(() =>
  Math.max(1000, Math.min(15000, Math.round(Number(node.value?.params?.novelTargetWords) || 3200)))
)
const autoAdvance = computed(() => node.value?.params?.novelAutoAdvanceChapter !== false)
const worldBible = computed(() => String(node.value?.params?.novelWorldBible ?? ''))
const stateLedger = computed(() => String(node.value?.params?.novelStateLedger ?? ''))
const rollingSummary = computed(() => String(node.value?.params?.novelRollingSummary ?? ''))
const historyMap = computed(() =>
  parseNovelChapterHistory(node.value?.params?.novelChapterHistoryJson)
)
const historyCount = computed(() => Object.keys(historyMap.value).length)
const prevTailAnchor = computed(() => {
  if (currentChapter.value <= 1) return ''
  return historyMap.value[String(currentChapter.value - 1)]?.tailAnchor ?? ''
})
const prevTailMeta = computed(() =>
  currentChapter.value <= 1
    ? L(
        '当前为第 1 章（开篇首章无需上一章末尾锚点）', // cjk-ok
        'Currently at Chapter 1 (opening chapter needs no previous tail anchor)'
      )
    : L(
        `第 ${currentChapter.value} 章将自动紧接以下【第 ${currentChapter.value - 1} 章末尾原文】无缝续写：`, // cjk-ok
        `Chapter ${currentChapter.value} will seamlessly continue from the end of Chapter ${currentChapter.value - 1}:`
      )
)

const uiText = computed(() => ({
  badge: L('逐章连载引擎', 'Chapter Serializer'), // cjk-ok
  curChapPrefix: L('当前第', 'Ch.'), // cjk-ok
  totalChapPrefix: L('共', 'Total'), // cjk-ok
  chapUnit: L('章', 'Ch'), // cjk-ok
  prevChapTip: L('切换到上一章', 'Previous Chapter'), // cjk-ok
  nextChapTip: L('切换到下一章', 'Next Chapter'), // cjk-ok
  totalChapTip: L(
    '动态总章数（随时可修改，自动重算全书分卷、境界阶梯与单章战力上限）', // cjk-ok
    'Dynamic total chapters (recalibrates volume map & chapter power ceiling in real time)'
  ),
  wordsLabel: L('单章字数:', 'Words/Ch:'), // cjk-ok
  wordsUnit: L('字+', 'w+'), // cjk-ok
  autoAdvanceLbl: L('自动+1章', 'Auto +1 Ch'), // cjk-ok
  autoAdvanceTip: L(
    '生成完当前第 N 章后，自动将连载游标推进至第 N+1 章', // cjk-ok
    'Automatically advance chapter cursor to N+1 after generating Chapter N'
  ),
  memoryBtn: L('四层记忆账本', '4-Tier Memory'), // cjk-ok
  tabLedger: L('L2 动态状态与底牌账本', 'L2 Live State Ledger'), // cjk-ok
  tabBible: L('L1 恒定世界观宪法', 'L1 World Bible'), // cjk-ok
  tabSummary: L('L3 滚动前情摘要', 'L3 Rolling Summary'), // cjk-ok
  tabTail: L('L4 上一章末尾原文锚点', 'L4 Prev Chapter Tail'), // cjk-ok
  resetBtn: L('重置游标至第1章', 'Reset to Ch.1'), // cjk-ok
  resetTip: L('将当前章号游标重置回第 1 章', 'Reset current chapter cursor to Chapter 1'), // cjk-ok
  ledgerPlaceholder: L(
    '每章生成后自动同步主角当前境界、战力上限、已解锁底牌、封存底牌与章末悬念钩子（也可手动修正）...', // cjk-ok
    'Auto-updated after each chapter with current realm, unlocked trumps & cliffhanger hooks...'
  ),
  biblePlaceholder: L(
    '全书恒定世界观、力量/财富等级铁律、主角性格底色与金手指法则（跨百章/千章锁定不漂移）...', // cjk-ok
    'Constant world rules, power hierarchy & protagonist core traits locked across all chapters...'
  ),
  summaryPlaceholder: L(
    '每章生成后自动追加单行前情浓缩摘要与已出场反派记录，防止长篇连载前后吃书或重复套路...', // cjk-ok
    'Auto-appended chapter summaries to prevent plot repetition across long serialization...'
  ),
  tailEmpty: L(
    '（尚未记录上一章末尾原文；生成第 1 章后将自动提取末尾原文供第 2 章无缝续写）', // cjk-ok
    '(No previous chapter tail yet; will be auto-captured after generating the previous chapter)'
  )
}))

function patchParams(patch: Record<string, unknown>): void {
  if (!props.hostId || !props.nodeId) return
  graphEditorHosts.updateNode(props.hostId, props.nodeId, patch)
}

function stepChapter(delta: number): void {
  const next = Math.max(1, Math.min(totalChapters.value, currentChapter.value + delta))
  patchParams({ novelCurrentChapter: next })
}

function onCurrentChapterChange(e: Event): void {
  const raw = Number((e.target as HTMLInputElement).value) || 1
  const next = Math.max(1, Math.min(totalChapters.value, Math.round(raw)))
  patchParams({ novelCurrentChapter: next })
}

function onTotalChaptersChange(e: Event): void {
  const raw = Number((e.target as HTMLInputElement).value) || 800
  setTotalChapters(raw)
}

function setTotalChapters(raw: number): void {
  const nextTotal = Math.max(1, Math.min(5000, Math.round(raw)))
  const nextCur = Math.min(currentChapter.value, nextTotal)
  patchParams({
    novelTotalChapters: nextTotal,
    novelCurrentChapter: nextCur
  })
}

function onTargetWordsChange(e: Event): void {
  const raw = Number((e.target as HTMLInputElement).value) || 3200
  const nextWords = Math.max(1000, Math.min(15000, Math.round(raw)))
  patchParams({ novelTargetWords: nextWords })
}

function onAutoAdvanceChange(e: Event): void {
  const checked = (e.target as HTMLInputElement).checked
  patchParams({ novelAutoAdvanceChapter: checked })
}

function onLedgerChange(e: Event): void {
  patchParams({ novelStateLedger: (e.target as HTMLTextAreaElement).value })
}

function onBibleChange(e: Event): void {
  patchParams({ novelWorldBible: (e.target as HTMLTextAreaElement).value })
}

function onSummaryChange(e: Event): void {
  patchParams({ novelRollingSummary: (e.target as HTMLTextAreaElement).value })
}

function resetNovelProgress(): void {
  patchParams({ novelCurrentChapter: 1 })
}
</script>

<style scoped>
.novel-serializer {
  margin-bottom: 8px;
  padding: 6px 8px;
  border-radius: 7px;
  background: rgba(168, 85, 247, 0.08);
  border: 1px solid rgba(168, 85, 247, 0.28);
  font-size: 11px;
  color: var(--text);
}

.novel-serializer-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}

.novel-badge {
  padding: 2px 6px;
  border-radius: 4px;
  font-weight: 700;
  font-size: 10px;
  background: rgba(168, 85, 247, 0.22);
  color: #c084fc;
}

.novel-field-group {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}

.novel-lbl {
  color: var(--text-muted);
  font-size: 10.5px;
}

.novel-num-input {
  height: 21px;
  padding: 0 4px;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: var(--bg-elev);
  color: var(--text);
  font-size: 11px;
  font-weight: 600;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.novel-num-input.is-chap {
  width: 46px;
}

.novel-num-input.is-total {
  width: 54px;
}

.novel-num-input.is-words {
  width: 54px;
}

.novel-step-btn,
.novel-pill-btn,
.novel-memory-btn,
.novel-mem-tab,
.novel-mem-reset {
  height: 21px;
  padding: 0 6px;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: var(--bg-panel);
  color: var(--text-muted);
  font-size: 10px;
  cursor: pointer;
}

.novel-step-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.novel-quick-totals {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}

.novel-pill-btn.is-active,
.novel-memory-btn.is-open,
.novel-mem-tab.is-active {
  border-color: rgba(168, 85, 247, 0.65);
  background: rgba(168, 85, 247, 0.2);
  color: #e9d5ff;
  font-weight: 600;
}

.novel-chk {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 10.5px;
  color: var(--text-muted);
  cursor: pointer;
}

.novel-memory-btn {
  margin-left: auto;
}

.novel-memory-drawer {
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px dashed rgba(168, 85, 247, 0.28);
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.novel-memory-tabs {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
}

.novel-mem-reset {
  margin-left: auto;
}

.novel-mem-textarea {
  width: 100%;
  min-height: 68px;
  padding: 6px 8px;
  border-radius: 5px;
  border: 1px solid var(--border);
  background: var(--bg-elev);
  color: var(--text);
  font-size: 11px;
  line-height: 1.45;
  resize: vertical;
}

.novel-tail-preview {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.novel-tail-meta {
  font-size: 10px;
  color: #c084fc;
}

.novel-tail-code {
  margin: 0;
  padding: 6px 8px;
  max-height: 92px;
  overflow: auto;
  border-radius: 5px;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  font-size: 10.5px;
  white-space: pre-wrap;
  color: var(--text-muted);
}
</style>
