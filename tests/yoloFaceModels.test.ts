import { describe, expect, it } from 'vitest'
import type { YoloModelInfo } from '../src/shared/yolo'
import { faceModelAliases, pickFaceModel } from '../src/shared/yoloFaceModels'

/**
 * 人脸两段式模型的角色挑选（`src/shared/yoloFaceModels.ts`）。
 *
 * 这里错了不会报错：检测器位置喂了 FaceMesh（或反过来）只在推理时维度不符，
 * 渲染层按「可选能力」降级成空脸 —— 用户看到的是「五官 / 妆容 / 证件照悄悄不生效」。
 * 所以把挑选规则锁死，尤其两条保守设计：
 * 1. 名字明显属于另一角色的文件永不被顶替使用；
 * 2. 同一个文件不会被两段复用。
 */

function model(id: string, sizeMb: number): YoloModelInfo {
  return { id, kind: 'face', path: `/models/${id}.onnx`, sizeMb }
}

describe('pickFaceModel', () => {
  it('约定名各就各位：检测器与 FaceMesh 各取各的', () => {
    const models = [model('face-landmark', 3), model('face-detect', 2)]
    const detector = pickFaceModel({ models, role: 'detector' })
    const landmark = pickFaceModel({ models, role: 'landmark' })
    expect(detector.model?.id).toBe('face-detect')
    expect(detector.via).toBe('alias')
    expect(landmark.model?.id).toBe('face-landmark')
    expect(landmark.via).toBe('alias')
  })

  it('只放了检测器时，FaceMesh 一侧必须是「找不到」而不是拿检测器顶替', () => {
    const models = [model('face-detect', 2)]
    const detector = pickFaceModel({ models, role: 'detector' })
    const landmark = pickFaceModel({ models, role: 'landmark', excludePath: detector.model?.path })
    expect(detector.model?.id).toBe('face-detect')
    expect(landmark.model).toBeNull()
    expect(landmark.via).toBe('none')
    // 报错文案要能告诉用户缺的是哪个角色
    expect(faceModelAliases('landmark')).toContain('face-landmark')
  })

  it('只放了 FaceMesh 时，检测器一侧同样必须是「找不到」', () => {
    const models = [model('face-landmark', 3)]
    const landmark = pickFaceModel({ models, role: 'landmark' })
    const detector = pickFaceModel({
      models,
      role: 'detector',
      excludePath: landmark.model?.path
    })
    expect(landmark.model?.id).toBe('face-landmark')
    expect(detector.model).toBeNull()
  })

  it('容忍变体命名：按名字特征命中，且体积兜底不抢角色', () => {
    const models = [model('face-detect-v2-int8', 1.5), model('facemesh-v2', 4)]
    expect(pickFaceModel({ models, role: 'detector' }).model?.id).toBe('face-detect-v2-int8')
    expect(pickFaceModel({ models, role: 'landmark' }).model?.id).toBe('facemesh-v2')
    // 别名表里也要有 facemesh，用户直接用官方名时走 alias 而不是 affinity
    expect(pickFaceModel({ models: [model('facemesh', 4)], role: 'landmark' }).via).toBe('alias')
  })

  it('名字完全无关时按体积兜底，且两段不会指向同一个文件', () => {
    const models = [model('face-big', 9), model('face-small', 4)]
    const landmark = pickFaceModel({ models, role: 'landmark' })
    const detector = pickFaceModel({ models, role: 'detector', excludePath: landmark.model?.path })
    expect(landmark.model?.id).toBe('face-big')
    expect(landmark.via).toBe('fallback')
    expect(detector.model?.id).toBe('face-small')
  })

  it('同体积时按 id 排序，挑到的文件稳定', () => {
    const models = [model('face-zzz', 5), model('face-aaa', 5)]
    expect(pickFaceModel({ models, role: 'landmark' }).model?.id).toBe('face-aaa')
  })

  it('显式指定优先；指定的 id 不存在时返回 none 并带上目录里现有的人脸模型', () => {
    const models = [model('face-detect', 2), model('face-landmark', 3)]
    const hit = pickFaceModel({ models, role: 'detector', explicit: 'face-landmark' })
    expect(hit.model?.id).toBe('face-landmark')
    expect(hit.via).toBe('explicit')
    const miss = pickFaceModel({ models, role: 'detector', explicit: 'nope' })
    expect(miss.model).toBeNull()
    expect(miss.available).toEqual(['face-detect', 'face-landmark'])
  })

  it('非 face 档位的模型不参与人脸挑选', () => {
    const models: YoloModelInfo[] = [
      { id: 'yolo11n-face', kind: 'detect', path: '/models/yolo11n-face.onnx', sizeMb: 99 },
      model('face-detect', 2)
    ]
    const pick = pickFaceModel({ models, role: 'detector' })
    expect(pick.model?.id).toBe('face-detect')
    expect(pick.available).toEqual(['face-detect'])
  })
})
