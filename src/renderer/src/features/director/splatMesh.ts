import * as THREE from 'three'
import type { Object3D } from 'three'

/**
 * 高斯泼溅（Gaussian Splatting）加载 / 渲染层。
 *
 * 支持两种官方产物：
 * - `.spz`：Marble 随世界**免费**返回的泼溅（世界生成时已随主产物落盘并登记资产）
 * - `.ply`：官方 `worlds/{id}:export` 导出的 PLY 泼溅（同步但单独计费）
 *
 * 渲染交给 Spark（`@sparkjsdev/spark`）：
 * - 它把 Rust/wasm 在构建期以 base64 **内联**进 bundle，worker 走 Blob / data URL，
 *   因此 Electron 下**不需要**额外拷贝 wasm / worker 静态资源（这是接入前唯一的打包风险点，已实测通过）；
 * - 泼溅网格是普通 `Object3D`（内部 `SplatMesh extends Object3D`），可直接进导演台场景层级参与
 *   选中 / 变换 / 显隐；
 * - 除了网格本身，**场景里还必须有一层 `SparkRenderer`**（一个挂载在场景上的 `THREE.Mesh`，
 *   在 `onBeforeRender` 里把泼溅画进当前 render target），否则泼溅不会出画。
 *   该渲染层与泼溅网格一样按需动态 import，不进首屏 bundle。
 */

/**
 * 泼溅文件扩展名（模型资产口径，与 assetImport 的 MODEL_EXT 对齐）。
 *
 * 定义已移到 `@shared/mediaFileExtensions`（扫盘也要用它决定同批谁当代表，
 * 而那边不能引 three.js）；这里 import 后 re-export，保持既有 import 路径可用。
 */
import { SPLAT_EXTENSIONS } from '@shared/mediaFileExtensions'

export { SPLAT_EXTENSIONS }

/**
 * 加载「无进展」上限：连续这么久没有任何字节进展就判定卡死。
 *
 * 泼溅的解析在 Spark 的 Web Worker 里做（worker 走 Blob URL），
 * 一旦那条链路静默失败（worker 里 wasm 起不来、自定义协议在 worker 里取不到文件），
 * `SplatMesh.initialized` 会**永远 pending** —— 界面就是一直「正在加载」，
 * 既不报错也不结束。宁可按预算失败并抛出来，也不要挂死 UI。
 *
 * 只要还在收字节（`onProgress`）就重置计时，所以大文件慢下载不会误判。
 */
export const SPLAT_STALL_TIMEOUT_MS = 20_000

/**
 * 泼溅网格标记：`SplatMesh` 走自己的着色器，不是普通材质网格，
 * 材质实例化 / 改色 / 着色模式叠加都必须跳过它，否则会把泼溅染成白模或直接不出画。
 */
export const GAUSSIAN_SPLAT_FLAG = 'isGaussianSplatMesh'

/** 是否泼溅产物（按扩展名；大小写不敏感） */
export function isSplatPath(pathOrUrl: string): boolean {
  const clean = (pathOrUrl ?? '').split(/[?#]/)[0]?.toLowerCase() ?? ''
  return SPLAT_EXTENSIONS.some((ext) => clean.endsWith(ext))
}

/** 是否由本模块创建的泼溅网格（用于跳过普通网格的材质 / 着色处理） */
export function isGaussianSplatObject(object: Object3D | null | undefined): boolean {
  return object?.userData?.[GAUSSIAN_SPLAT_FLAG] === true
}

/**
 * 取景 / 包围盒兜底：`THREE.Box3.setFromObject` 对泼溅求到的是**空盒**
 *（几何体由 Spark 在渲染前构造，那一步 `geometry` 还没有 position 属性），
 * 这里回退到 `SplatMesh.getBoundingBox()` 并换算到世界空间。
 * 返回空盒表示树里确实没有可测量的泼溅。
 */
export function splatObjectBounds(object: Object3D): THREE.Box3 {
  const box = new THREE.Box3()
  object.updateMatrixWorld(true)
  object.traverse((child) => {
    if (!isGaussianSplatObject(child)) return
    const getBoundingBox = (
      child as unknown as { getBoundingBox?: (centersOnly?: boolean) => THREE.Box3 | undefined }
    ).getBoundingBox
    const local = typeof getBoundingBox === 'function' ? getBoundingBox.call(child) : undefined
    if (!local || local.isEmpty()) return
    box.union(local.clone().applyMatrix4(child.matrixWorld))
  })
  return box
}

/**
 * 建一个泼溅网格（懒加载 Spark，避免把渲染器打进首屏）。
 * `url` 由调用方给出：导演台用工程文件的既有 URL 约定，绝对路径 / blob URL 都行。
 * 内部 await 初始化：泼溅未就绪前不进场景；解析失败或**卡住**都会抛出，由调用方兜底。
 */
export async function createSplatMesh(input: {
  url: string
  name?: string
  /** 无进展判定上限（毫秒），缺省 {@link SPLAT_STALL_TIMEOUT_MS}；测试可注入 */
  stallTimeoutMs?: number
}): Promise<Object3D> {
  const { SplatMesh } = await import('@sparkjsdev/spark')
  const stallBudget = input.stallTimeoutMs ?? SPLAT_STALL_TIMEOUT_MS
  let settled = false
  let sawProgress = false
  let lastLoaded = 0
  let stallTimer: ReturnType<typeof setTimeout> | undefined
  let armStall: () => void = () => {}
  // Spark 的 worker 在某些环境下会静默失败（既不回结果也不报错），
  // 这里按「长时间没有任何字节进展」判死，避免把 UI 挂住
  const stall = new Promise<never>((_resolve, reject) => {
    armStall = () => {
      if (settled) return
      if (stallTimer !== undefined) clearTimeout(stallTimer)
      stallTimer = setTimeout(() => {
        reject(
          new Error(
            `Splat load stalled: no progress for ${Math.round(stallBudget / 1000)}s ` +
              `(loaded ${lastLoaded} bytes)` +
              (sawProgress ? '' : ' — no data arrived at all')
          )
        )
      }, stallBudget)
    }
    armStall()
  })
  const mesh = new SplatMesh({
    url: input.url,
    raycastable: true,
    onProgress: (event: { loaded?: number }) => {
      // 有字节进展就续命：大文件慢下载不该被当成卡死
      sawProgress = true
      lastLoaded = Math.max(lastLoaded, event?.loaded ?? 0)
      armStall()
    }
  })
  // Spark 的 SplatMesh 声明未暴露 Object3D 成员，这里按场景层级所需的三维对象类型返回
  const object = mesh as unknown as THREE.Object3D
  try {
    await Promise.race([mesh.initialized, stall])
  } catch (err) {
    // 半成品网格不能留在外面（它可能已经起了 worker / 占了显存）
    ;(mesh as unknown as { dispose?: () => void }).dispose?.()
    throw err
  } finally {
    settled = true
    if (stallTimer !== undefined) clearTimeout(stallTimer)
  }
  object.userData[GAUSSIAN_SPLAT_FLAG] = true
  if (input.name?.trim()) object.name = input.name.trim()
  return object
}

/**
 * 泼溅渲染层：挂在场景上才会出画。
 *
 * **按场景各一层**（WeakMap 键是 scene，随场景一起被回收）：导演台、3D 预览、缩略图
 * 摆拍可能同时存在，共用一个模块级单例会让后挂上的那个把前一个场景的泼溅「带走」——
 * 表现为先开的预览突然变空。
 */
const sparkLayers = new WeakMap<THREE.Scene, THREE.Mesh>()
/** 已挂出的渲染层（只为「全量释放」保留强引用；WeakMap 负责按场景查） */
const sparkLayerRegistry = new Set<THREE.Mesh>()
/** 同一场景并发的建层请求只跑一次（`scene → promise`） */
const sparkLayerLoading = new WeakMap<THREE.Scene, Promise<THREE.Mesh>>()

/**
 * 幂等：同一场景只建一层（重复调用，包括同一场景里多份泼溅接连进场景，都复用这一层）。
 * 宿主若换掉了 renderer（例如整块重建 WebGL 上下文），先 `disposeSparkLayer(scene)` 再调用。
 */
export async function ensureSparkLayer(input: {
  scene: THREE.Scene
  renderer: THREE.WebGLRenderer
  onDirty?: () => void
}): Promise<THREE.Mesh> {
  const scene = input.scene
  const existing = sparkLayers.get(scene)
  if (existing) return existing
  const loading = sparkLayerLoading.get(scene)
  if (loading) return loading
  const task = (async () => {
    const { SparkRenderer } = await import('@sparkjsdev/spark')
    // 加载期间舞台可能已被卸载 / 换过 scene
    const layer = new SparkRenderer({ renderer: input.renderer, onDirty: input.onDirty })
    // Spark 的 d.ts 在 three 版本差异下不总能解析出 Object3D 成员，按场景对象口径取名
    ;(layer as unknown as THREE.Object3D).name = 'SparkSplatLayer'
    scene.add(layer as unknown as THREE.Object3D)
    sparkLayers.set(scene, layer)
    sparkLayerRegistry.add(layer)
    return layer
  })()
  sparkLayerLoading.set(scene, task)
  try {
    return await task
  } finally {
    sparkLayerLoading.delete(scene)
  }
}

/**
 * 泼溅累加器的「喂数据」：**必须显式调一次**，光靠渲染回调里 Spark 自己的懒更新不够。
 *
 * 实测（scripts/splat-inspect）：只让它自己更新时，着色器会编译、几何体也画了，
 * 但 `activeSplats` 始终是 0 —— **一个泼溅都没进累加器**，画面接近空白。
 * 显式 `update({ scene, camera })` 之后 `activeSplats` 变成全部点数、画面正常出图。
 * 所以每次「泼溅进场景 / 相机重新取景」之后都要喂一次，
 * 否则就是那个经典现象：模型加载完了、不报错、也看不见东西。
 */
export async function primeSparkLayer(input: {
  scene: THREE.Scene
  camera: THREE.Camera
}): Promise<boolean> {
  const layer = sparkLayers.get(input.scene) as unknown as
    { update?: (input: { scene: THREE.Scene; camera: THREE.Camera }) => Promise<void> } | undefined
  const update = layer?.update
  if (typeof update !== 'function') return false
  try {
    await update.call(layer, { scene: input.scene, camera: input.camera })
    return true
  } catch (err) {
    console.warn('[splat] priming the Spark accumulator failed:', err)
    return false
  }
}

/**
 * 释放泼溅渲染层。
 * - 传 scene：只释放该场景那层（模型预览 / 缩略图用）；
 * - 不传：释放全部（舞台卸载时兜底，避免留下没有网格的渲染层）。
 * 泼溅网格本身由各自宿主 dispose，这里只管渲染层。
 */
export function disposeSparkLayer(scene?: THREE.Scene | null): void {
  if (scene) {
    const layer = sparkLayers.get(scene)
    if (!layer) return
    sparkLayers.delete(scene)
    detachSparkLayer(layer)
    return
  }
  for (const layer of [...sparkLayerRegistry]) detachSparkLayer(layer)
  sparkLayerRegistry.clear()
}

function detachSparkLayer(layer: THREE.Mesh): void {
  sparkLayerRegistry.delete(layer)
  layer.removeFromParent()
  ;(layer as unknown as { dispose?: () => void }).dispose?.()
}
