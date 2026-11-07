import { describe, expect, it } from 'vitest'
import { entitiesFromVlmResponse } from '../src/main/services/semanticTimeline/entityDetectVlm'
import { normalizeDeepSeekOfficialModelId } from '../src/main/services/modelProviders/deepseek/adapter'
import {
  supportsVisionTextModel,
  visionGroundingScore,
  type ModelProviderInstance
} from '../src/shared/modelProvider'
import {
  createEmptySemanticTimeline,
  ensureSemanticStructure,
  finalizeSemanticBreakdown,
  parseReaWholeVideoResponse,
  type ShotEvidence
} from '../src/shared/semanticTimeline'

/**
 * 实体检测从本地 YOLO 换成多模态大模型后，**解析与归并规则**成了新的正确性边界：
 * 模型会少给字段、给未知 kind、把同一实体拆成多项、给不存在的镜头 id —— 都要在这里收敛。
 */
function shot(id: string, start: number, end: number): ShotEvidence {
  return {
    id,
    range: { start, end, startFrame: Math.round(start * 30), endFrame: Math.round(end * 30) },
    keyframes: { middle: `evidence/keyframes/${id}.middle.jpg` },
    confidence: 1
  }
}

const shots = [shot('shot.001.0', 0, 3), shot('shot.002.5', 3, 6)]

describe('entitiesFromVlmResponse', () => {
  it('解析基本字段并挂上镜头证据（range 取自镜头）', () => {
    const entities = entitiesFromVlmResponse(
      JSON.stringify([
        { name: '腰包', kind: 'product', shots: ['shot.001.0', 'shot.002.5'] },
        { name: '主播', kind: 'person', shots: ['shot.001.0'] }
      ]),
      shots
    )
    expect(entities).toHaveLength(2)
    const bag = entities.find((e) => e.name === '腰包')!
    expect(bag.kind).toBe('product')
    expect(bag.id).toBe('ent.product.腰包')
    expect(bag.appearances.map((a) => a.shotId)).toEqual(['shot.001.0', 'shot.002.5'])
    expect(bag.appearances[0]!.range).toEqual(shots[0]!.range)
    // 视觉模型不给框 → 不能声称可做像素级替换
    expect(bag.pixelEditable).toBe(false)
  })

  it('同一实体跨镜头出现只留一项（按 kind + 名称归并）', () => {
    const entities = entitiesFromVlmResponse(
      JSON.stringify([
        { name: '腰包', kind: 'product', shots: ['shot.001.0'] },
        { name: '腰包', kind: 'product', shots: ['shot.002.5'] }
      ]),
      shots
    )
    expect(entities).toHaveLength(1)
    expect(entities[0]!.appearances.map((a) => a.shotId)).toEqual(['shot.001.0', 'shot.002.5'])
  })

  it('未知 kind 回落到 kindOfLabel：只认 COCO 式英文标签，其余一律 object', () => {
    const entities = entitiesFromVlmResponse(
      JSON.stringify([
        { name: 'cup', kind: 'tableware', shots: ['shot.001.0'] },
        { name: 'face', kind: '???', shots: ['shot.001.0'] },
        { name: '快递箱', kind: '???', shots: ['shot.001.0'] },
        // 中文商品名不在 COCO 标签里 → 落到 object（不硬猜语义；kind 本来就在提示词里要求给）
        { name: '杯子', kind: 'tableware', shots: ['shot.001.0'] }
      ]),
      shots
    )
    expect(entities.find((e) => e.name === 'cup')!.kind).toBe('product')
    expect(entities.find((e) => e.name === 'face')!.kind).toBe('person')
    expect(entities.find((e) => e.name === '快递箱')!.kind).toBe('object')
    expect(entities.find((e) => e.name === '杯子')!.kind).toBe('object')
  })

  it('丢弃不存在的镜头 id（证据不能指向不存在的镜头）', () => {
    const entities = entitiesFromVlmResponse(
      JSON.stringify([{ name: '腰包', kind: 'product', shots: ['shot.999.0'] }]),
      shots
    )
    expect(entities).toEqual([])
  })

  it('shots 给成单个字符串也认', () => {
    const entities = entitiesFromVlmResponse(
      JSON.stringify([{ name: 'logo', kind: 'logo', shots: 'shot.002.5' }]),
      shots
    )
    expect(entities[0]!.appearances.map((a) => a.shotId)).toEqual(['shot.002.5'])
  })

  it('容忍 ```json 围栏与前后解释文字', () => {
    const text =
      '好的，结果如下：\n```json\n[{"name":"价格文字","kind":"text","shots":["shot.001.0"]}]\n```\n以上。'
    const entities = entitiesFromVlmResponse(text, shots)
    expect(entities).toHaveLength(1)
    expect(entities[0]!.kind).toBe('text')
  })

  it('没有名字 / 空数组 / 垃圾文本 → 空结果，不抛异常', () => {
    expect(entitiesFromVlmResponse('[]', shots)).toEqual([])
    expect(entitiesFromVlmResponse('', shots)).toEqual([])
    expect(entitiesFromVlmResponse('not json at all', shots)).toEqual([])
    expect(entitiesFromVlmResponse(JSON.stringify([{ kind: 'person' }]), shots)).toEqual([])
  })

  it('id 冲突时加序号，且不含空格/标点', () => {
    const entities = entitiesFromVlmResponse(
      JSON.stringify([
        { name: 'Support Bag', kind: 'product', shots: ['shot.001.0'] },
        { name: 'support bag!', kind: 'product', shots: ['shot.002.5'] }
      ]),
      shots
    )
    expect(entities).toHaveLength(2)
    for (const e of entities) expect(e.id).toMatch(/^ent\.product\.[a-z0-9-]+$/)
    expect(new Set(entities.map((e) => e.id)).size).toBe(2)
  })

  it('兼容多模态大语言模型返回 1-based 序号、[1, 2]、S1 与简写 shot.1', () => {
    const paddedShots = [shot('shot.0001', 0, 3), shot('shot.0002', 3, 6)]
    const entities = entitiesFromVlmResponse(
      JSON.stringify([
        { name: '男主播', kind: 'person', shots: [1, 'S2'] },
        { name: '运动鞋', kind: 'product', shots: ['shot.1'] }
      ]),
      paddedShots
    )
    expect(entities).toHaveLength(2)
    expect(entities.find((e) => e.name === '男主播')?.appearances.map((a) => a.shotId)).toEqual([
      'shot.0001',
      'shot.0002'
    ])
    expect(entities.find((e) => e.name === '运动鞋')?.appearances.map((a) => a.shotId)).toEqual([
      'shot.0001'
    ])
  })
})

describe('多模态大语言模型（DeepSeek V4.1 Flash 等）路由与整片实体回填', () => {
  it('识别 DeepSeek V4.1 Flash 及其各渠道别名作为多模态视觉模型，并归一化官方模型 ID', () => {
    for (const modelId of [
      'deepseek-flash',
      'deepseek/deepseek-v4.1-flash',
      'deepseekv4.1-flash',
      'deepseek-v4-flash',
      'deepseek-v4-pro',
      'deepseek-vl2'
    ]) {
      expect(visionGroundingScore(modelId), modelId).toBeGreaterThan(0)
    }
    expect(normalizeDeepSeekOfficialModelId('deepseek-v4.1-flash')).toBe('deepseek-flash')
    expect(normalizeDeepSeekOfficialModelId('deepseekv4.1-flash')).toBe('deepseek-flash')
    expect(normalizeDeepSeekOfficialModelId('deepseek-v4-flash')).toBe('deepseek-flash')
    expect(normalizeDeepSeekOfficialModelId('deepseek-flash')).toBe('deepseek-flash')

    const customProvider = {
      id: 'p1',
      label: 'OpenRouter',
      providerKind: 'openrouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: 'k',
      enabled: true,
      modalities: {
        text: {
          selectedModelIds: ['vendor/custom-multimodal-x'],
          defaultModelId: 'vendor/custom-multimodal-x',
          catalog: {
            'vendor/custom-multimodal-x': {
              id: 'vendor/custom-multimodal-x',
              name: 'Custom Multimodal X',
              capabilities: {
                architecture: { modality: 'text+image->text' }
              }
            }
          }
        }
      }
    } as unknown as ModelProviderInstance
    expect(supportsVisionTextModel(customProvider, 'vendor/custom-multimodal-x')).toBe(true)
  })

  it('parseReaWholeVideoResponse 解析 cast 并由 finalizeSemanticBreakdown 回填角色实体轨道', () => {
    const whole = parseReaWholeVideoResponse(
      JSON.stringify({
        summary: '双人口播带货',
        cast: {
          characters: [
            { id: 'C1', name: '男主播', kind: 'human', look: '眼镜短发', shotIds: ['1', '2'] }
          ],
          props: [{ id: 'P1', name: '新款耳机', realMaterial: true, shotIds: ['2'] }]
        }
      })
    )
    expect(whole?.cast?.characters).toHaveLength(1)
    expect(whole?.cast?.props).toHaveLength(1)

    const s1 = shot('shot.0001', 0, 3)
    const s2 = shot('shot.0002', 3, 6)
    let doc = createEmptySemanticTimeline('asset.1', {
      durationSec: 6,
      fps: 30,
      width: 1280,
      height: 720,
      hasAudio: true
    })
    doc = ensureSemanticStructure(doc, { shots: [s1, s2] })
    doc = finalizeSemanticBreakdown(doc, { wholeVideo: whole ?? undefined })

    expect(doc.entities.map((e) => e.name)).toEqual(['男主播', '新款耳机'])
    expect(doc.entities[0]!.appearances.map((a) => a.shotId)).toEqual(['shot.0001', 'shot.0002'])
    expect(doc.shots?.[0]?.subjects[0]?.entityId).toBe(doc.entities[0]!.id)
  })

  it('无视觉模型产出时按确定性人脸特征与口播台词兜底生成实体轨道', () => {
    const s1: ShotEvidence = {
      ...shot('shot.0001', 0, 4),
      forensics: {
        hsvHist: [0.5, 0.3, 0.2, 0, 0, 0, 0, 0],
        aspects: { framing: { subjectKind: 'face', area: 0.18, shotSize: 'mcu' } }
      }
    }
    let doc = createEmptySemanticTimeline('asset.2', {
      durationSec: 4,
      fps: 30,
      width: 1280,
      height: 720,
      hasAudio: true
    })
    doc = ensureSemanticStructure(doc, {
      shots: [s1],
      utterances: [
        {
          id: 'utt.1',
          range: { start: 0.2, end: 3.5, startFrame: 6, endFrame: 105 },
          text: '大家好',
          granularity: 'sentence',
          confidence: 0.9
        }
      ]
    })
    doc = finalizeSemanticBreakdown(doc, { synthesizeFallbackEntities: true })

    expect(doc.entities.some((e) => e.kind === 'person')).toBe(true)
    expect(doc.entities.some((e) => e.kind === 'voice')).toBe(true)
  })
})
