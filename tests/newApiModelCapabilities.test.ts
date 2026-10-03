import { describe, expect, it } from 'vitest'
import {
  isNewApiImageModel,
  isNewApiTextModelId,
  resolveNewApiModelRoutes
} from '../src/shared/modelProviders/newapi/modelCapabilities'
import {
  parseNewApiPricing,
  resolveNewApiSiteRoot
} from '../src/main/services/modelProviders/newapi/adapter'

// 端点字典取自真实 NewAPI 网关的 GET /api/pricing
const ENDPOINTS = {
  gemini: { path: '/v1beta/models/{model}:generateContent', method: 'POST' },
  'image-edit': { path: '/v1/images/edits', method: 'POST' },
  'image-generation': { path: '/v1/images/generations', method: 'POST' },
  openai: { path: '/v1/chat/completions', method: 'POST' }
}

describe('newapi 端点判定', () => {
  it('从端点类型解析出实际路径', () => {
    expect(resolveNewApiModelRoutes(['openai'], ENDPOINTS)).toEqual({
      chat: '/v1/chat/completions'
    })
    expect(resolveNewApiModelRoutes(['openai', 'image-generation'], ENDPOINTS)).toEqual({
      chat: '/v1/chat/completions',
      generation: '/v1/images/generations'
    })
    expect(resolveNewApiModelRoutes(['image-edit', 'image-generation'], ENDPOINTS)).toEqual({
      edit: '/v1/images/edits',
      generation: '/v1/images/generations'
    })
  })

  it('端点字典缺失时仍能识别命中关系（路径留空，由调用方回退）', () => {
    expect(resolveNewApiModelRoutes(['image-generation'])).toEqual({ generation: undefined })
    expect(resolveNewApiModelRoutes(['openai'])).toEqual({ chat: undefined })
  })

  it('端点类型大小写与下划线写法都容忍', () => {
    expect(resolveNewApiModelRoutes(['Image-Generation'], ENDPOINTS).generation).toBe(
      '/v1/images/generations'
    )
    expect(resolveNewApiModelRoutes(['image_generation'], ENDPOINTS).generation).toBe(
      '/v1/images/generations'
    )
  })

  it('元数据声明能出图的模型归入图片（即使 id 不含图片特征）', () => {
    // grok-imagine-image 靠命名判定不出来，靠元数据可以
    expect(isNewApiImageModel('grok-imagine-image', ['openai', 'image-generation'])).toBe(true)
    expect(isNewApiTextModelId('grok-imagine-image', ['openai', 'image-generation'])).toBe(false)
    // 只声明 openai 的对话模型仍是文本
    expect(isNewApiImageModel('deepseek-chat', ['openai'])).toBe(false)
    expect(isNewApiTextModelId('deepseek-chat', ['openai'])).toBe(true)
  })

  it('没有元数据时退回命名启发式', () => {
    expect(isNewApiImageModel('gpt-image-2.5-flare')).toBe(true)
    expect(isNewApiImageModel('nano-banana-pro')).toBe(true)
    expect(isNewApiImageModel('flux.1-schnell')).toBe(true)
    expect(isNewApiImageModel('deepseek-chat')).toBe(false)
    expect(isNewApiImageModel('claude-3-5-sonnet')).toBe(false)
  })

  it('空 id 一律不算文本模型', () => {
    expect(isNewApiTextModelId('')).toBe(false)
    expect(isNewApiTextModelId('   ')).toBe(false)
  })
})

describe('newapi 站点根与 pricing 解析', () => {
  it('Base URL 去掉 /v1 得到站点根，用于打 /api/pricing', () => {
    expect(resolveNewApiSiteRoot('https://origingateway.com/v1')).toBe('https://origingateway.com')
    expect(resolveNewApiSiteRoot('https://gw.example.com/v1/')).toBe('https://gw.example.com')
    expect(resolveNewApiSiteRoot('https://gw.example.com')).toBe('https://gw.example.com')
    expect(resolveNewApiSiteRoot('')).toBe('')
  })

  it('解析 /api/pricing：端点字典 + 每个模型的端点类型', () => {
    const meta = parseNewApiPricing({
      supported_endpoint: ENDPOINTS,
      data: [
        {
          model_name: 'grok-imagine-image',
          supported_endpoint_types: ['openai', 'image-generation']
        },
        { model_name: 'gpt-image-2', supported_endpoint_types: ['openai'] },
        { model_name: 'deepseek-chat', supported_endpoint_types: ['openai'] },
        { model_name: 'no-endpoints' }
      ]
    })
    expect(meta.endpoints['image-generation']?.path).toBe('/v1/images/generations')
    expect(meta.byModel['grok-imagine-image']).toEqual(['openai', 'image-generation'])
    expect(meta.byModel['no-endpoints']).toEqual([])
  })

  it('pricing 载荷异常时不抛错，返回空元数据', () => {
    expect(parseNewApiPricing(undefined)).toEqual({ endpoints: {}, byModel: {} })
    expect(parseNewApiPricing({ data: 'nope' })).toEqual({ endpoints: {}, byModel: {} })
  })
})
