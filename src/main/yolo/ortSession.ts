/**
 * ONNX Runtime 推理会话工厂：优先启用原生 GPU 硬件加速（Windows DirectML / NVIDIA CUDA / macOS CoreML），
 * 并在无可用显卡或驱动异常时自动无缝回退到 CPU。
 */
import type { YoloBackend } from '@shared/yolo'

type OrtModule = typeof import('onnxruntime-node')
type OrtSession = import('onnxruntime-node').InferenceSession

const GPU_PROVIDER_PRIORITY: readonly YoloBackend[] = ['cuda', 'dml', 'coreml']

let activeBackend: YoloBackend | null = null
let forcedCpuFallback = false

/**
 * 探测当前 onnxruntime-node 原生支持的最高优先级后端。
 */
export function detectPreferredOrtBackend(mod: OrtModule): YoloBackend {
  if (forcedCpuFallback) return 'cpu'
  try {
    const supported = mod.listSupportedBackends?.() ?? []
    for (const candidate of GPU_PROVIDER_PRIORITY) {
      if (supported.some((b) => b.name === candidate)) {
        return candidate
      }
    }
  } catch {
    // ignore backend enumeration errors and fallback to cpu
  }
  return 'cpu'
}

/**
 * 获取当前生效（或探测就绪）的推理后端标识。
 */
export function getActiveOrtBackend(mod: OrtModule | null): YoloBackend {
  if (activeBackend) return activeBackend
  if (!mod) return 'cpu'
  return detectPreferredOrtBackend(mod)
}

/**
 * 创建 ONNX 推理会话：
 * - 若探测到 GPU 后端（如 Windows DirectML `dml`），优先使用 `[preferred, 'cpu']` 混合执行；
 *   DirectML 规范要求关闭 `enableMemPattern` 并采用 `sequential` 执行模式以保证稳定性。
 * - 若 GPU 会话初始化失败（例如无 DX12 显卡的虚拟机或驱动故障），自动回退到纯 `'cpu'` 并记忆状态。
 */
export async function createOrtSession(mod: OrtModule, modelPath: string): Promise<OrtSession> {
  const preferred = detectPreferredOrtBackend(mod)
  if (preferred !== 'cpu') {
    try {
      const session = await mod.InferenceSession.create(modelPath, {
        executionProviders: [preferred, 'cpu'],
        graphOptimizationLevel: 'all',
        enableMemPattern: preferred === 'dml' ? false : true,
        executionMode: preferred === 'dml' ? 'sequential' : 'parallel',
        logSeverityLevel: 3
      })
      activeBackend = preferred
      return session
    } catch (err) {
      console.warn(
        `[yolo-ort] GPU backend "${preferred}" failed to initialize, falling back to CPU:`,
        err instanceof Error ? err.message : String(err)
      )
      forcedCpuFallback = true
      activeBackend = 'cpu'
    }
  }

  const session = await mod.InferenceSession.create(modelPath, {
    executionProviders: ['cpu'],
    graphOptimizationLevel: 'all',
    logSeverityLevel: 3
  })
  activeBackend = 'cpu'
  return session
}
