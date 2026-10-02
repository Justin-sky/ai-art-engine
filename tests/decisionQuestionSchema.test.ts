import { describe, expect, it } from 'vitest'
import {
  buildDecisionRequestPreview,
  createDecisionQuestionDraft,
  decisionQuestionIssues,
  draftsToQuestions,
  parseDecisionQuestionsDetailed,
  stringifyDecisionQuestions,
  withDecisionQuestionType
} from '../src/shared/decisionQuestionSchema'
import { parseDecisionQuestions, toDecisionQuestionBodies } from '../src/shared/decisionQuestion'

const DSL = [
  '# 注释行',
  'is_ok | noul | 这个方案成立吗？ | 满足设定与逻辑 / 存在明显漏洞',
  'pick | choice | 选哪个方案？ | a:方案A; b:方案B; c:方案C',
  'quality | score | 质量如何？ | 需要返工; 基本可用; 可直接用'
].join('\n')

describe('parseDecisionQuestionsDetailed', () => {
  it('解析出三种类型的问题，并跳过注释', () => {
    const result = parseDecisionQuestionsDetailed(DSL)

    expect(result.commentLines).toBe(1)
    expect(result.failedLines).toEqual([])
    expect(result.questions.map((q) => [q.key, q.type])).toEqual([
      ['is_ok', 'noul'],
      ['pick', 'choice'],
      ['quality', 'score']
    ])
    expect(result.questions[0]).toMatchObject({ yes: '满足设定与逻辑', no: '存在明显漏洞' })
    expect(result.questions[1]!.options).toEqual([
      { value: 'a', description: '方案A' },
      { value: 'b', description: '方案B' },
      { value: 'c', description: '方案C' }
    ])
    expect(result.questions[2]!.levels.map((l) => l.label)).toEqual([
      '需要返工',
      '基本可用',
      '可直接用'
    ])
  })

  /** 这是当初最坑的一点：解析失败的行被静默丢掉，用户只会发现「问题不见了」 */
  it('把读不懂的行号报回来，而不是静默丢弃', () => {
    const result = parseDecisionQuestionsDetailed(
      ['is_ok | noul | 成立吗？ | 是 / 否', '这行没有分隔符', 'bad | rating | 类型不认识'].join(
        '\n'
      )
    )

    expect(result.questions).toHaveLength(1)
    expect(result.failedLines).toEqual([2, 3])
  })
})

describe('stringifyDecisionQuestions', () => {
  it('产物能被执行路径原样读回（往返稳定）', () => {
    const drafts = parseDecisionQuestionsDetailed(DSL).questions
    const text = stringifyDecisionQuestions(drafts)

    // 表单重写一遍后，执行路径解析出的问题与源一致
    expect(parseDecisionQuestions(text)).toEqual(parseDecisionQuestions(DSL))
    // 再跑一轮也不漂移
    const again = stringifyDecisionQuestions(parseDecisionQuestionsDetailed(text).questions)
    expect(again).toBe(text)
  })

  it('只填了一侧说明时不凭空补出斜杠', () => {
    const [draft] = parseDecisionQuestionsDetailed(DSL).questions
    const text = stringifyDecisionQuestions([{ ...draft!, no: '' }])
    expect(text).toBe('is_ok | noul | 这个方案成立吗？ | 满足设定与逻辑')
    expect(parseDecisionQuestions(text)[0]!.noulCriteria?.no).toMatch(/does not hold/)
  })

  it('选项说明与值相同时不重复写成 `值:值`', () => {
    const text = stringifyDecisionQuestions([
      {
        key: 'pick',
        type: 'choice',
        instructions: '选哪个？',
        yes: '',
        no: '',
        options: [
          { value: 'a', description: 'a' },
          { value: 'b', description: '方案B' }
        ],
        levels: []
      }
    ])
    expect(text).toBe('pick | choice | 选哪个？ | a; b:方案B')
  })
})

describe('draftsToQuestions', () => {
  it('与执行路径同口径：补 noul 兜底说明、丢空选项', () => {
    const questions = draftsToQuestions([
      {
        key: 'is_ok',
        type: 'noul',
        instructions: '成立吗？',
        yes: '',
        no: '',
        options: [],
        levels: []
      },
      {
        key: 'pick',
        type: 'choice',
        instructions: '选哪个？',
        yes: '',
        no: '',
        options: [
          { value: 'a', description: '' },
          { value: '', description: '垃圾项' }
        ],
        levels: []
      }
    ])

    expect(questions[0]!.noulCriteria?.yes).toMatch(/holds/)
    expect(questions[1]!.choices).toEqual([{ value: 'a', description: 'a' }])
    // 组装成上游请求体时不会因为空项被整体丢掉
    expect(toDecisionQuestionBodies(questions)).toHaveLength(2)
  })
})

describe('buildDecisionRequestPreview（表单模式预览）', () => {
  const note = '（state 运行时才有）'

  it('展示会真正发给模型的 model 与 questions', () => {
    const drafts = parseDecisionQuestionsDetailed(DSL).questions
    const preview = buildDecisionRequestPreview(drafts, {
      model: 'typesafe/jev-1.13',
      omittedNote: note,
      emptyText: ''
    })

    expect(preview.includedKeys).toEqual(['is_ok', 'pick', 'quality'])
    expect(preview.droppedKeys).toEqual([])
    const payload = JSON.parse(preview.text.split('\n\n')[0]!) as {
      model: string
      questions: Record<string, { type: string }>
    }
    expect(payload.model).toBe('typesafe/jev-1.13')
    expect(Object.keys(payload.questions)).toEqual(['is_ok', 'pick', 'quality'])
    expect(payload.questions.is_ok!.type).toBe('noul')
    expect(preview.text).toContain(note)
  })

  /** 这是表单预览存在的理由：表单上看着填了、实际发不出去的问题，必须当场看见 */
  it('点名会被执行路径丢掉的问题，而不是让它们静默消失', () => {
    const drafts = parseDecisionQuestionsDetailed(DSL).questions
    const broken = [
      ...drafts,
      // 缺选项的 choice
      {
        key: 'broken_choice',
        type: 'choice' as const,
        instructions: '选一个',
        yes: '',
        no: '',
        options: [],
        levels: []
      },
      // 没填问题名的 noul
      {
        key: '',
        type: 'noul' as const,
        instructions: '',
        yes: '',
        no: '',
        options: [],
        levels: []
      }
    ]

    const preview = buildDecisionRequestPreview(broken, {
      model: '',
      omittedNote: note,
      emptyText: ''
    })

    expect(preview.includedKeys).toEqual(['is_ok', 'pick', 'quality'])
    expect(preview.droppedKeys).toEqual(['broken_choice', '(unnamed)'])
  })

  it('未选模型时不编造 model 字段；一条都没有时给空态文案', () => {
    const drafts = parseDecisionQuestionsDetailed(DSL).questions
    const noModel = buildDecisionRequestPreview(drafts, {
      model: '',
      omittedNote: note,
      emptyText: ''
    })
    expect(noModel.text).not.toContain('"model"')

    const empty = buildDecisionRequestPreview([], {
      model: 'x',
      omittedNote: note,
      emptyText: '还没有可发出的问题'
    })
    expect(empty.text).toBe('还没有可发出的问题')
    expect(empty.includedKeys).toEqual([])
  })
})

describe('表单辅助', () => {
  it('新问题的 key 自动避让已有名字', () => {
    expect(createDecisionQuestionDraft('noul', []).key).toBe('q1')
    expect(createDecisionQuestionDraft('noul', ['q1', 'q2']).key).toBe('q3')
  })

  it('切到 choice / score 时补齐最小格数，切走再切回不丢已填内容', () => {
    const noul = createDecisionQuestionDraft('noul', [])
    const choice = withDecisionQuestionType(noul, 'choice')
    expect(choice.options).toHaveLength(2)
    const score = withDecisionQuestionType({ ...choice, levels: [] }, 'score')
    expect(score.levels).toHaveLength(2)
    // 已填的选项仍然在（切类型不清空）
    expect(withDecisionQuestionType(choice, 'noul').options).toHaveLength(2)
  })

  it('校验只报缺什么，不阻止保存', () => {
    expect(
      decisionQuestionIssues({
        key: 'k',
        type: 'choice',
        instructions: '选哪个？',
        yes: '',
        no: '',
        options: [],
        levels: []
      })
    ).toEqual(['missingOptions'])
    expect(
      decisionQuestionIssues({
        key: '',
        type: 'score',
        instructions: '',
        yes: '',
        no: '',
        options: [],
        levels: []
      })
    ).toEqual(['missingKey', 'missingInstructions', 'missingLevels'])
  })
})
