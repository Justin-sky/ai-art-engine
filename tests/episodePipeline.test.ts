import { describe, expect, it } from 'vitest'
import {
  applyEpisodeReviewMarks,
  applyEpisodeAgentReview,
  createEpisodeAgentState,
  EPISODE_AGENT_MOTION_9,
  episodeFailReasonForStep,
  extractEpisodeBeatNumber,
  formatEpisodeKeyframeSpanNotes,
  getAiWorkflowPresetPlan,
  materializeGraphPlan,
  parseEpisodeBeatBoard,
  parseEpisodeBeatBreakdown,
  parseEpisodeDirectorVerdict,
  parseEpisodeMotionPrompts,
  parseEpisodeSequenceBoard,
  replaceEpisodeMotionPrompt,
  selectEpisodeAnchors,
  selectEpisodeAnchor,
  selectEpisodeCell,
  selectEpisodeKeyframeSpans,
  selectEpisodeMotion
} from '../src/shared/graph'

const BEAT_BOARD = `# 9宫格核心锚点
## 格1 [节拍ID: #1] - 师陷冤狱
- **景别与视角**: 远景 (WS) / 俯拍
- **人物描述**: 沈约，素色寝衣，披发
- **场景与光影**: 窗外冷色月光作为主顶光
- **构图与动线**: 前景锁链，中景沈约，后景皇宫高墙
- **故事功能**: 建立悬念
## 格2 [节拍ID: #2] - 夜探天监阁
- **景别与视角**: 中景 (MS) / 平视
- **人物描述**: 沈青梧，夜行深衣
- **场景与光影**: 月光自左上方恒定照射
- **构图与动线**: 前景算筹，中景青梧，后景星图屏风
- **故事功能**: 揭示核心道具`

const BEAT_BREAKDOWN = `| 节拍编号 | 事件摘要 | 观众获得 (信息/情绪) | 情绪强度 (1-10) | 关键锚点 (是/否) |
|---------|---------|-------------------|----------------|----------------|
| #1 | 太史令沈约被御林军从梦中押走 | 悬念：为何被抓？ | 7 | 是 |
| #2 | 沈青梧夜探天监阁找算筹 | 转折：发现关键道具 | 6 | 否 |`

const SEQUENCE_BOARD = `# 展开的 9组/4宫格 动态故事板
## 组1: 师陷冤狱 -> 对应九宫格 格1
- **格1-1 (定场)**: 全景镜头，建立破门而入的动势。（景别: 全景）
- **格1-2 (引入)**: 中景镜头，捕捉主角惊骇的反应。（景别: 中景）
- **格1-3 (冲突)**: 近景镜头，特写沈约被戴上镣铐。（景别: 近景）
- **格1-4 (收尾)**: 中景镜头，主角被押出府门。（景别: 全景/中景）
## 组2: 夜探天监阁 -> 对应九宫格 格2
- **格2-1 (定场)**: 远景，月光下的天监阁飞檐。（景别: 远景）
- **格2-2 (引入)**: 中景，青梧走向星图屏风。（景别: 中景）
- **格2-3 (冲突)**: 近景，指尖触到算筹时门外传来脚步声。（景别: 近景）
- **格2-4 (收尾)**: 全景，青梧吹熄烛火隐入暗处。（景别: 全景）`

const MOTION_PROMPTS = `# 图生视频动态指令
## 镜头1 [来源: 4宫格 组1-格1]
- **Camera Move**: 向前推轨 (Dolly In)
- **Subject Action**: 士兵破门而入，预备：肩部后缩顶门 -> 发力：门被撞开 -> 缓冲：前冲两步稳住重心。
- **Env Action**: 门外风涌入室内，吹动烛火剧烈摇晃。
- **Duration**: 4秒
## 镜头2 [来源: 4宫格 组1-格2]
- **Camera Move**: 固定微持 (Static)
- **Subject Action**: 沈约惊坐起身，预备：肩颈绷紧 -> 发力：掀被欲下床 -> 缓冲：被剑光逼停。
- **Env Action**: 火把烟尘涌入，帐幔掀动后回落。
- **Duration**: 3秒`

describe('episode board parse', () => {
  it('parses beat breakdown table', () => {
    const rows = parseEpisodeBeatBreakdown(BEAT_BREAKDOWN)
    expect(rows.length).toBe(2)
    expect(rows[0]).toMatchObject({ index: 1, summary: '太史令沈约被御林军从梦中押走', intensity: 7, anchor: true })
    expect(rows[1]).toMatchObject({ index: 2, anchor: false })
  })

  it('parses beat breakdown rows without # prefix', () => {
    const rows = parseEpisodeBeatBreakdown(
      '| 节拍编号 | 事件摘要 | 观众获得 | 情绪强度 | 关键锚点 |\n' +
        '| 1 | 开场 | 悬念 | 5 | 是 |\n' +
        '| 2 | 转折 | 信息 | 8 | 否 |'
    )
    expect(rows.length).toBe(2)
    expect(rows[0]).toMatchObject({ index: 1, summary: '开场', intensity: 5, anchor: true })
    expect(rows[1]).toMatchObject({ index: 2, anchor: false })
  })

  it('parses 9-grid beat board into anchors', () => {
    const rows = parseEpisodeBeatBoard(BEAT_BOARD)
    expect(rows.length).toBe(2)
    expect(rows[0]?.index).toBe(1)
    expect(rows[0]?.title).toBe('师陷冤狱')
    expect(rows[0]?.beatId).toBe('1')
    expect(rows[0]?.text).toContain('主顶光')
    expect(selectEpisodeAnchor(BEAT_BOARD, 2)?.title).toBe('夜探天监阁')
    expect(selectEpisodeAnchor(BEAT_BOARD, 9)).toBeNull()
  })

  it('parses beat refs from English and compact forms', () => {
    const en = parseEpisodeBeatBoard('## 格1 [Beat ID: #2] - 夜探\n- 正文')
    expect(en[0]?.beatId).toBe('2')
    const noHash = parseEpisodeBeatBoard('## 格1 [节拍ID: 3] - 标题\n- 正文')
    expect(noHash[0]?.beatId).toBe('3')
    expect(extractEpisodeBeatNumber('B4')).toBe(4)
    expect(extractEpisodeBeatNumber('节拍5')).toBe(5)
    expect(extractEpisodeBeatNumber('#6')).toBe(6)
    expect(extractEpisodeBeatNumber('')).toBeNull()
    expect(extractEpisodeBeatNumber(undefined)).toBeNull()
  })

  it('selects top anchors by intensity when too many are marked', () => {
    const rows = parseEpisodeBeatBreakdown(
      '| 节拍编号 | 事件摘要 | 观众获得 | 情绪强度 | 关键锚点 |\n' +
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
          .map((n) => `| ${n} | 事件${n} | 信息 | ${n} | 是 |`)
          .join('\n')
    )
    const anchors = selectEpisodeAnchors(rows, 9)
    expect(anchors.length).toBe(9)
    expect(anchors.map((a) => a.index)).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12])
  })

  it('fills remaining cells from non-anchor beats when short', () => {
    const rows = parseEpisodeBeatBreakdown(
      '| 节拍编号 | 事件摘要 | 观众获得 | 情绪强度 | 关键锚点 |\n' +
        '| 1 | a | x | 3 | 是 |\n' +
        '| 2 | b | x | 9 | 否 |\n' +
        '| 3 | c | x | 7 | 否 |'
    )
    const anchors = selectEpisodeAnchors(rows, 9)
    expect(anchors.map((a) => a.index)).toEqual([1, 2, 3])
  })

  it('extends the last keyframe span through remaining tail beats', () => {
    const header = '| 节拍编号 | 事件摘要 | 观众获得 | 情绪强度 | 关键锚点 |'
    const marked = [1, 2, 3, 4, 5, 6, 7, 8, 9]
      .map((n) => `| ${n} | 锚点${n} | x | ${n} | 是 |`)
      .join('\n')
    const rows = parseEpisodeBeatBreakdown(
      `${header}\n${marked}\n| 10 | 余波 | x | 4 | 否 |\n| 11 | 收束 | x | 3 | 否 |`
    )
    const spans = selectEpisodeKeyframeSpans(rows, 9)
    expect(spans).toHaveLength(9)
    expect(spans[8]).toMatchObject({
      cell: 9,
      fromBeat: 9,
      toBeat: 11,
      keyframeBeat: 9
    })
    expect(spans[8]?.tailBeats.map((beat) => beat.index)).toEqual([10, 11])
    const notes = formatEpisodeKeyframeSpanNotes(spans)
    expect(notes).toContain('末端关键帧')
    expect(notes).toContain('#10')
    expect(notes).toContain('收束')
  })

  it('keeps last span at the keyframe when it is already the final beat', () => {
    const header = '| 节拍编号 | 事件摘要 | 观众获得 | 情绪强度 | 关键锚点 |'
    const marked = [1, 2, 3, 4, 5, 6, 7, 8, 9]
      .map((n) => `| ${n} | 事件${n} | x | ${n} | 是 |`)
      .join('\n')
    const rows = parseEpisodeBeatBreakdown(`${header}\n${marked}`)
    const spans = selectEpisodeKeyframeSpans(rows, 9)
    expect(spans[8]).toMatchObject({ fromBeat: 9, toBeat: 9, keyframeBeat: 9 })
    expect(spans[8]?.tailBeats).toEqual([])
    expect(formatEpisodeKeyframeSpanNotes(spans)).not.toContain('并含其后剩余节拍')
  })

  it('asks motion-9 prompts to cover tail beats after the last keyframe', () => {
    expect(EPISODE_AGENT_MOTION_9.systemPromptZh).toContain('末端关键帧')
    expect(EPISODE_AGENT_MOTION_9.systemPromptZh).toContain('直至剧本结束')
    expect(EPISODE_AGENT_MOTION_9.instructionZh).toContain('末端关键帧')
  })

  it('parses sequence board into 36 cells', () => {
    const rows = parseEpisodeSequenceBoard(SEQUENCE_BOARD)
    expect(rows.length).toBe(8)
    expect(rows[0]).toMatchObject({ groupIndex: 1, cellIndex: 1, key: '格1-1', stage: '定场' })
    expect(rows[4]).toMatchObject({ groupIndex: 2, cellIndex: 1, key: '格2-1', stage: '定场' })
    expect(selectEpisodeCell(SEQUENCE_BOARD, 2, 3)?.text).toContain('脚步声')
    expect(selectEpisodeCell(SEQUENCE_BOARD, 9, 4)).toBeNull()
  })

  it('parses motion prompts into 36 rows with group/cell mapping', () => {
    const rows = parseEpisodeMotionPrompts(MOTION_PROMPTS)
    expect(rows.length).toBe(2)
    expect(rows[0]).toMatchObject({ groupIndex: 1, cellIndex: 1, key: '格1-1' })
    expect(rows[1]?.key).toBe('格1-2')
    expect(selectEpisodeMotion(MOTION_PROMPTS, 1, 2)?.text).toContain('沈约惊坐起身')
    const patched = replaceEpisodeMotionPrompt(MOTION_PROMPTS, 1, 2, '- **Duration**: 5秒')
    expect(patched).toContain('## 镜头2')
    expect(selectEpisodeMotion(patched, 1, 2)?.text).toContain('Duration**: 5秒')
    expect(selectEpisodeMotion(patched, 1, 1)?.text).toContain('Dolly In')
    expect(replaceEpisodeMotionPrompt(MOTION_PROMPTS, 9, 1, 'x')).toBeNull()
    expect(selectEpisodeMotion(MOTION_PROMPTS, 3, 1)).toBeNull()
  })
})

describe('episode agent state machine', () => {
  it('creates initial state at breakdown', () => {
    const state = createEpisodeAgentState('ep01-师陷冤狱', 'ep01')
    expect(state.current_step).toBe('breakdown')
    expect(state.output_files.breakdown).toBe('outputs/beat-breakdown-ep01.md')
  })

  it('advances on PASS and rolls back on FAIL with reason', () => {
    const initial = createEpisodeAgentState('ep01-师陷冤狱', 'ep01')
    const passed = applyEpisodeAgentReview(initial, 'breakdown', 'PASS', '')
    expect(passed.current_step).toBe('beatboard')
    expect(passed.last_failed_reason).toBe('')
    const failed = applyEpisodeAgentReview(passed, 'beatboard', 'FAIL', '第二幕视高跳跃太大')
    expect(failed.current_step).toBe('beatboard')
    expect(failed.last_failed_reason).toBe('第二幕视高跳跃太大')
    expect(failed.reviews?.length).toBe(2)
  })

  it('episodeFailReasonForStep falls back to latest FAIL review', () => {
    const state = createEpisodeAgentState('ep01-师陷冤狱', 'ep01')
    const failed = applyEpisodeAgentReview(state, 'beatboard', 'FAIL', '第二幕视高跳跃太大')
    // current_step 对齐时直接取 last_failed_reason
    expect(episodeFailReasonForStep(failed, 'beatboard')).toBe('第二幕视高跳跃太大')
    // 后续步骤被乱序推进后，仍能回退到该阶段最近一次 FAIL
    const pushed = applyEpisodeAgentReview(failed, 'sequence', 'PASS', '')
    expect(pushed.current_step).toBe('motion')
    expect(episodeFailReasonForStep(pushed, 'beatboard')).toBe('第二幕视高跳跃太大')
    expect(episodeFailReasonForStep(pushed, 'sequence')).toBe('')
  })

  it('does not attach historical FAIL after the stage passed', () => {
    const state = createEpisodeAgentState('ep01-师陷冤狱', 'ep01')
    const failed = applyEpisodeAgentReview(state, 'beatboard', 'FAIL', '第二幕视高跳跃太大')
    const passed = applyEpisodeAgentReview(failed, 'beatboard', 'PASS', '')
    expect(episodeFailReasonForStep(passed, 'beatboard')).toBe('')
  })
})

describe('episode director verdict', () => {
  it('parses PASS / FAIL / missing verdict', () => {
    expect(parseEpisodeDirectorVerdict('## 结论: PASS')).toEqual({ result: 'PASS', reason: '' })
    expect(
      parseEpisodeDirectorVerdict('## 结论: FAIL (原因: 第二幕视高跳跃太大)')
    ).toEqual({ result: 'FAIL', reason: '第二幕视高跳跃太大' })
    expect(parseEpisodeDirectorVerdict('没有结论')).toBeNull()
  })

  it('parses FAIL reasons on the next line and full-width punctuation', () => {
    expect(
      parseEpisodeDirectorVerdict('## 结论: FAIL\n原因：第二幕视高跳跃太大')
    ).toEqual({ result: 'FAIL', reason: '第二幕视高跳跃太大' })
    expect(
      parseEpisodeDirectorVerdict('## 结论：FAIL（原因：格3主光跳变）')
    ).toEqual({ result: 'FAIL', reason: '格3主光跳变' })
    expect(
      parseEpisodeDirectorVerdict(
        '## 审核清单\n- 叙事完整性：5/5\n- 视觉一致性：4/5\n\n## 结论: FAIL\n原因：缺少第 3 组对白'
      )
    ).toEqual({ result: 'FAIL', reason: '缺少第 3 组对白' })
  })

  it('marks review node and upstream node with FAIL result', () => {
    const review = {
      id: 'review-node',
      typeId: 'prompt.optimize',
      params: {
        episodeReviewTarget: 'beatboard',
        text: '## 结论: FAIL (原因: 第二幕视高跳跃太大)'
      }
    }
    const upstream = {
      id: 'beatboard-node',
      typeId: 'prompt.optimize',
      params: { episodeStep: 'beatboard' }
    }
    const patched = new Map<string, Record<string, unknown>>()
    applyEpisodeReviewMarks([review, upstream] as never[], (nodeId, params) => {
      patched.set(nodeId, params as Record<string, unknown>)
    })
    expect(patched.get('review-node')).toMatchObject({
      episodeReviewStatus: 'FAIL',
      episodeReviewReason: '第二幕视高跳跃太大',
      episodeReviewPending: false
    })
    expect(patched.get('beatboard-node')).toMatchObject({
      episodeReviewStatus: 'FAIL',
      episodeReviewPending: false
    })
  })
})

describe('shortDrama agent pipeline preset', () => {
  it('materializes the 9×4=36 pipeline', () => {
    const plan = getAiWorkflowPresetPlan('shortDrama')!
    expect(plan.nodes.length).toBe(137)
    const result = materializeGraphPlan(plan, {
      scope: 'subgraphAsset',
      assetType: 'subgraph'
    })
    expect(result.ok, result.error).toBe(true)
    const nodes = result.document!.nodes
    // 9宫格：一个拼图生成节点 + 9 个本地宫格提取
    expect(nodes.filter((n) => n.typeId === 'episode.anchorSelect').length).toBe(0)
    expect(nodes.filter((n) => n.typeId === 'asset.image').length).toBe(10)
    expect(nodes.filter((n) => n.typeId === 'image.gridSplit').length).toBe(45)
    expect(nodes.filter((n) => n.typeId === 'image.upscale').length).toBe(0)
    expect(nodes.filter((n) => n.typeId === 'episode.cellSelect').length).toBe(36)
    expect(nodes.filter((n) => n.typeId === 'asset.video').length).toBe(36)
    // 9宫格提取：每节点只提取对应 1 格
    const grid9 = nodes.filter(
      (n) => n.typeId === 'image.gridSplit' && n.params.imageGridSplit?.rows === 3
    )
    expect(grid9.length).toBe(9)
    expect(
      grid9.every((n) => n.params.imageGridSplit?.selected?.length === 1)
    ).toBe(true)
    // 4宫格提取：2×2 布局，每节点提取对应 1 格
    const grid4 = nodes.filter(
      (n) => n.typeId === 'image.gridSplit' && n.params.imageGridSplit?.cols === 2
    )
    expect(grid4.length).toBe(36)
    expect(
      grid4.every((n) => n.params.imageGridSplit?.selected?.length === 1)
    ).toBe(true)
    const breakdown = nodes.find((n) => n.params.episodeStep === 'breakdown')
    expect(breakdown).toBeTruthy()
    expect(breakdown?.params.generateSystemPrompt).toContain('分镜师')
    expect(breakdown?.params.skillId).toBe('episode.breakdown')
    const review = nodes.find((n) => n.params.episodeReviewTarget === 'motion')
    expect(review).toBeTruthy()
    const video = nodes.find((n) => n.typeId === 'asset.video')
    const img9 = nodes.find((n) => n.title?.includes('9宫格拼图'))
    expect(img9?.params.episodeStep).toBe('beatboard')
    const img4 = nodes.find((n) => n.title?.includes('4宫格拼图'))
    expect(img4?.params.episodeStep).toBe('sequence')
    expect(img9?.params.skillId).toBe('episode.image.grid9')
    expect(img4?.params.skillId).toBe('episode.image.grid4')
    expect(video?.params.skillId).toBe('episode.video.grid4')
    expect(video?.params.generateFrameMode).toBeUndefined()
    const edges = result.document!.edges
    const titleById = new Map<string, string>()
    for (const node of nodes) titleById.set(node.id, node.title ?? '')
    const sourceTitles = (target: string | undefined): string[] =>
      edges.filter((edge) => edge.target === target).map((edge) => titleById.get(edge.source) ?? '')
    const reviewBreakdown = nodes.find((n) => n.params.episodeReviewTarget === 'breakdown')
    expect(sourceTitles(reviewBreakdown?.id)).toEqual(
      expect.arrayContaining(['剧本', '分镜师·节拍拆解表'])
    )
    expect(
      sourceTitles(nodes.find((n) => n.params.episodeReviewTarget === 'motion')?.id)
    ).toEqual(
      expect.arrayContaining([
        '剧本',
        '分镜师·节拍拆解表',
        '分镜师·9宫格分镜表',
        '分镜师·4宫格动态分镜表',
        '动画师·动态提示词表'
      ])
    )
    expect(
      edges.some((e) => e.sourcePort === 'out' && e.targetPort === 'in-text')
    ).toBe(true)
    expect(
      edges.some((e) => e.sourcePort === 'out' && e.targetPort === 'in-image')
    ).toBe(true)
    // 高清放大节点已移除：9宫格提取图直接作 4宫格拼图参考图
    const extract9 = nodes.find((n) => n.title === '宫格提取·格1')
    expect(
      edges.some(
        (e) =>
          e.source === extract9?.id &&
          e.target === img4?.id &&
          e.targetPort === 'in-image'
      )
    ).toBe(true)
    // 4宫格提取图直接作动态视频参考图
    const extract4 = nodes.find((n) => n.title === '宫格提取·组1-格1')
    expect(
      edges.some(
        (e) =>
          e.source === extract4?.id &&
          e.target === video?.id &&
          e.targetPort === 'in-image'
      )
    ).toBe(true)
  })
})
