import { describe, expect, it } from 'vitest'
import {
  normalizeVideoInputReference,
  toOpenRouterInputReferenceBody
} from '../src/shared/openrouter'

describe('toOpenRouterInputReferenceBody', () => {
  it('treats bare string as image_url', () => {
    expect(normalizeVideoInputReference('data:image/png;base64,aaa')).toEqual({
      kind: 'image_url',
      url: 'data:image/png;base64,aaa'
    })
    expect(toOpenRouterInputReferenceBody('https://example.com/a.png')).toEqual({
      type: 'image_url',
      image_url: { url: 'https://example.com/a.png' }
    })
  })

  it('maps video_url and audio_url for Seedance-capable providers', () => {
    expect(
      toOpenRouterInputReferenceBody({
        kind: 'video_url',
        url: 'https://example.com/clip.mp4'
      })
    ).toEqual({
      type: 'video_url',
      video_url: { url: 'https://example.com/clip.mp4' }
    })
    expect(
      toOpenRouterInputReferenceBody({
        kind: 'audio_url',
        url: 'data:audio/mpeg;base64,bbb'
      })
    ).toEqual({
      type: 'audio_url',
      audio_url: { url: 'data:audio/mpeg;base64,bbb' }
    })
  })

  it('maps explicit image_url objects', () => {
    expect(
      toOpenRouterInputReferenceBody({
        kind: 'image_url',
        url: 'data:image/jpeg;base64,ccc'
      })
    ).toEqual({
      type: 'image_url',
      image_url: { url: 'data:image/jpeg;base64,ccc' }
    })
  })
})
