import { describe, expect, it } from 'vitest'
import { buildVolcengineArkVideoContent } from '../src/main/services/modelProviders/volcengineArk/adapter'

describe('buildVolcengineArkVideoContent', () => {
  it('always includes text prompt', () => {
    const content = buildVolcengineArkVideoContent({ prompt: 'a cat walks' })
    expect(content).toEqual([{ type: 'text', text: 'a cat walks' }])
  })

  it('assigns first_frame / last_frame roles', () => {
    const content = buildVolcengineArkVideoContent({
      prompt: 'transition',
      firstFrameImageUrl: 'https://cdn.example.com/first.png',
      lastFrameImageUrl: 'https://cdn.example.com/last.png'
    })
    expect(content).toContainEqual({
      type: 'image_url',
      image_url: { url: 'https://cdn.example.com/first.png' },
      role: 'first_frame'
    })
    expect(content).toContainEqual({
      type: 'image_url',
      image_url: { url: 'https://cdn.example.com/last.png' },
      role: 'last_frame'
    })
  })

  it('assigns reference_image role for image inputReferences', () => {
    const content = buildVolcengineArkVideoContent({
      prompt: 'style ref',
      inputReferences: [
        { kind: 'image_url', url: 'https://cdn.example.com/ref.png' },
        'https://cdn.example.com/bare.png'
      ]
    })
    const images = content.filter((c) => c.type === 'image_url')
    expect(images).toHaveLength(2)
    for (const item of images) {
      expect(item.role).toBe('reference_image')
      expect(item.image_url).toEqual(expect.objectContaining({ url: expect.any(String) }))
    }
  })

  it('assigns reference_video / reference_audio roles', () => {
    const content = buildVolcengineArkVideoContent({
      prompt: 'motion',
      inputReferences: [
        { kind: 'video_url', url: 'https://cdn.example.com/a.mp4' },
        { kind: 'audio_url', url: 'https://cdn.example.com/a.wav' }
      ]
    })
    expect(content).toContainEqual({
      type: 'video_url',
      video_url: { url: 'https://cdn.example.com/a.mp4' },
      role: 'reference_video'
    })
    expect(content).toContainEqual({
      type: 'audio_url',
      audio_url: { url: 'https://cdn.example.com/a.wav' },
      role: 'reference_audio'
    })
  })

  it('never emits image_url without role (regression for Ark 400)', () => {
    const content = buildVolcengineArkVideoContent({
      prompt: 'x',
      firstFrameImageUrl: 'https://a/1.png',
      inputReferences: [{ kind: 'image_url', url: 'https://a/2.png' }]
    })
    for (const item of content) {
      if (item.type === 'image_url' || item.type === 'video_url' || item.type === 'audio_url') {
        expect(typeof item.role).toBe('string')
        expect(String(item.role).length).toBeGreaterThan(0)
      }
    }
  })

  it('drops reference_image when last_frame is present', () => {
    const content = buildVolcengineArkVideoContent({
      prompt: 'transition',
      firstFrameImageUrl: 'https://cdn.example.com/first.png',
      lastFrameImageUrl: 'https://cdn.example.com/last.png',
      inputReferences: [
        { kind: 'image_url', url: 'https://cdn.example.com/ref.png' },
        { kind: 'video_url', url: 'https://cdn.example.com/a.mp4' }
      ]
    })
    const roles = content.map((c) => c.role).filter(Boolean)
    expect(roles).toContain('first_frame')
    expect(roles).toContain('last_frame')
    expect(roles).toContain('reference_video')
    expect(roles).not.toContain('reference_image')
  })

  it('rewrites @n to Seedance labels by media kind', () => {
    const content = buildVolcengineArkVideoContent({
      prompt: '参考@1画风，动作跟@2，口型跟@3',
      inputReferences: [
        { kind: 'image_url', url: 'https://cdn.example.com/a.png' },
        { kind: 'video_url', url: 'https://cdn.example.com/a.mp4' },
        { kind: 'audio_url', url: 'https://cdn.example.com/a.wav' }
      ]
    })
    expect(content[0]).toEqual({
      type: 'text',
      text: '参考图片1画风，动作跟视频1，口型跟音频1'
    })
  })

  it('offsets 图片 index after first_frame', () => {
    const content = buildVolcengineArkVideoContent({
      prompt: '主体参考@1',
      firstFrameImageUrl: 'https://cdn.example.com/first.png',
      inputReferences: [{ kind: 'image_url', url: 'https://cdn.example.com/ref.png' }]
    })
    expect(content[0]).toEqual({
      type: 'text',
      text: '主体参考图片2'
    })
  })

  it('leaves bare 图n untouched', () => {
    const content = buildVolcengineArkVideoContent({
      prompt: '图1中的角色跟随音频1'
    })
    expect(content[0]).toEqual({
      type: 'text',
      text: '图1中的角色跟随音频1'
    })
  })
})
