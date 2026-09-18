/**
 * Optional live Blender smoke for iterative humanoid skinning.
 * Skipped unless AIAE_BLENDER_SMOKE=1 and Blender MCP is reachable.
 *
 * Manual: start Blender + addon, then:
 *   AIAE_BLENDER_SMOKE=1 npx vitest run tests/blenderRigSkinSmoke.test.ts
 */
import { describe, expect, it } from 'vitest'
import { guardBlenderCode } from '../src/shared/blenderMcp'
import {
  BLENDER_HUMANOID_BIND_FROM_LANDMARKS_CODE,
  BLENDER_HUMANOID_LANDMARKS_CODE,
  BLENDER_RIG_QA_CODE,
  BLENDER_RIG_PREPARE_EXPORT_CODE
} from '../src/shared/blenderRigSkinPipeline'

const enabled = process.env.AIAE_BLENDER_SMOKE === '1'

describe.skipIf(!enabled)('blenderRigSkinSmoke (live)', () => {
  it('keeps the production scripts safe-mode clean before any live run', () => {
    for (const code of [
      BLENDER_HUMANOID_LANDMARKS_CODE,
      BLENDER_HUMANOID_BIND_FROM_LANDMARKS_CODE,
      BLENDER_RIG_QA_CODE,
      BLENDER_RIG_PREPARE_EXPORT_CODE
    ]) {
      expect(guardBlenderCode(code).ok).toBe(true)
    }
  })
})
