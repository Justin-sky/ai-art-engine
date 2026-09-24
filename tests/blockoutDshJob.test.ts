import { describe, expect, it } from 'vitest'
import {
  buildBlockoutJobBrief,
  buildBlockoutJobTask,
  parseBlockoutJobResult,
  validateBlockoutJobDelivery,
  blockoutDshError
} from '../src/shared/blockoutDshJob'
import { parseAiSceneBlockoutCall } from '../src/renderer/src/features/director/aiSceneBlockout'

describe('blockoutDshJob contract', () => {
  it('builds brief and task with refs and result path', () => {
    const brief = buildBlockoutJobBrief({
      instruction: '还原门廊',
      layoutMode: 'perspective',
      systemPrompt: 'SYSTEM_RULES',
      userPrompt: 'USER_CTX',
      resultAbs: 'F:/proj/Cache/BlockoutJobs/x/result.json',
      briefAbs: 'F:/proj/Cache/BlockoutJobs/x/brief.md',
      refRelativePaths: ['Cache/BlockoutJobs/x/refs/0.png']
    })
    expect(brief).toMatch(/multi-turn dsh/)
    expect(brief).toMatch(/SYSTEM_RULES/)
    expect(brief).toMatch(/USER_CTX/)
    expect(brief).toMatch(/@Cache\/BlockoutJobs\/x\/refs\/0\.png/)
    expect(brief).toMatch(/Do NOT call generate_image/)
    expect(brief).toMatch(/"ok":true/)

    const task = buildBlockoutJobTask({
      instruction: '还原门廊',
      layoutMode: 'perspective',
      systemPrompt: 'SYSTEM_RULES',
      userPrompt: 'USER_CTX',
      resultAbs: 'F:/proj/Cache/BlockoutJobs/x/result.json',
      briefAbs: 'F:/proj/Cache/BlockoutJobs/x/brief.md',
      refRelativePaths: ['Cache/BlockoutJobs/x/refs/0.png']
    })
    expect(task).toMatch(/result\.json/)
    expect(task).toMatch(/@Cache\/BlockoutJobs\/x\/refs\/0\.png/)
    expect(task).toMatch(/还原门廊/)
  })

  it('parses and validates result.json shapes', () => {
    expect(
      parseBlockoutJobResult(
        JSON.stringify({
          ok: true,
          summary: 'gate',
          objects: [{ name: 'pier', primitive: 'box' }]
        })
      )?.summary
    ).toBe('gate')

    const nested = parseBlockoutJobResult(
      JSON.stringify({
        name: 'build_scene',
        arguments: {
          summary: 'nested',
          objects: [{ name: 'a', primitive: 'box' }]
        }
      })
    )
    expect(nested?.ok).toBe(true)
    expect(nested?.objects?.length).toBe(1)

    expect(validateBlockoutJobDelivery(null)).toBe(blockoutDshError('RESULT'))
    expect(validateBlockoutJobDelivery({ ok: true, objects: [] })).toBe(
      blockoutDshError('NO_OBJECTS')
    )
    expect(
      validateBlockoutJobDelivery({
        ok: true,
        objects: [{ name: 'x' }]
      })
    ).toBeNull()
  })

  it('result.json with ok+objects is accepted by scene parser', () => {
    const raw = JSON.stringify({
      ok: true,
      summary: 'porch',
      objects: [
        {
          name: 'left pier',
          primitive: 'box',
          color: '#8a7a66',
          position: { x: -2, y: 1, z: -8 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 2, z: 1 }
        }
      ]
    })
    const call = parseAiSceneBlockoutCall(raw)
    expect(call?.arguments.objects[0]?.primitive).toBe('box')
    expect(call?.arguments.summary).toBe('porch')
  })
})
