import { describe, expect, it, vi } from 'vitest'
import {
  createOrtSession,
  detectPreferredOrtBackend,
  getActiveOrtBackend
} from '../src/main/yolo/ortSession'

describe('ortSession GPU priority & CPU fallback', () => {
  it('detects dml when supported by onnxruntime-node', () => {
    const fakeOrt = {
      listSupportedBackends: () => [
        { name: 'cpu', bundled: true },
        { name: 'dml', bundled: true }
      ],
      InferenceSession: { create: vi.fn() }
    } as unknown as typeof import('onnxruntime-node')

    expect(detectPreferredOrtBackend(fakeOrt)).toBe('dml')
  })

  it('creates DirectML session with enableMemPattern=false & sequential execution, and falls back to CPU on GPU error', async () => {
    const createMock = vi
      .fn()
      .mockResolvedValueOnce({ inputNames: ['input'], outputNames: ['output'] })
    const fakeOrt = {
      listSupportedBackends: () => [
        { name: 'cpu', bundled: true },
        { name: 'dml', bundled: true }
      ],
      InferenceSession: { create: createMock }
    } as unknown as typeof import('onnxruntime-node')

    await createOrtSession(fakeOrt, '/tmp/model.onnx')
    expect(createMock).toHaveBeenCalledWith(
      '/tmp/model.onnx',
      expect.objectContaining({
        executionProviders: ['dml', 'cpu'],
        enableMemPattern: false,
        executionMode: 'sequential'
      })
    )
    expect(getActiveOrtBackend(fakeOrt)).toBe('dml')

    // Simulate GPU driver failure on next call -> should auto-fallback to CPU
    const createFallbackMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('DX12 adapter not found'))
      .mockResolvedValueOnce({ inputNames: ['input'], outputNames: ['output'] })
    const fakeOrtFail = {
      listSupportedBackends: () => [
        { name: 'cpu', bundled: true },
        { name: 'dml', bundled: true }
      ],
      InferenceSession: { create: createFallbackMock }
    } as unknown as typeof import('onnxruntime-node')

    await createOrtSession(fakeOrtFail, '/tmp/model2.onnx')
    expect(createFallbackMock).toHaveBeenCalledTimes(2)
    expect(createFallbackMock).toHaveBeenLastCalledWith(
      '/tmp/model2.onnx',
      expect.objectContaining({
        executionProviders: ['cpu']
      })
    )
    expect(getActiveOrtBackend(fakeOrtFail)).toBe('cpu')
  })
})
