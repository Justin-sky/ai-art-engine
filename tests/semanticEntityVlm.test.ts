import { describe, expect, it } from 'vitest'
import { entitiesFromVlmResponse } from '../src/main/services/semanticTimeline/entityDetectVlm'
import type { ShotEvidence } from '../src/shared/semanticTimeline'

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
})
