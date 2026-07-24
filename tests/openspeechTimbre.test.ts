import { describe, expect, it } from 'vitest'
import {
  toVoiceDesignImagePrompt,
  VOLCENGINE_OPENSPEECH_BASE_URL
} from '../src/main/services/modelProviders/volcengineArk/openspeech'

describe('openspeech voice design', () => {
  it('exposes openspeech base url', () => {
    expect(VOLCENGINE_OPENSPEECH_BASE_URL).toBe('https://openspeech.bytedance.com')
  })

  it('maps data url to image_bytes and http to image_url', () => {
    expect(toVoiceDesignImagePrompt('data:image/png;base64,abc123')).toEqual({
      image_bytes: 'abc123'
    })
    expect(toVoiceDesignImagePrompt('https://cdn.example.com/a.png')).toEqual({
      image_url: 'https://cdn.example.com/a.png'
    })
  })
})
