import { afterEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'

/**
 * 泼溅识别 + Spark 接入的形状约束。
 *
 * 判定只认扩展名：`.spz` 是 Marble 随世界免费返回的那份、`.ply` 是官方导出那份，两者都要认。
 * Spark 本体的 WebGL 渲染只能在界面里手工验证，这里 mock 掉 `@sparkjsdev/spark`，
 * 只锁住**我们这一侧**的约定：网格标记、渲染层进场景、幂等与释放
 *（假渲染层自带 `removeFromParent`，与 Spark 的 `SparkRenderer extends Mesh` 同形）。
 */
const { createdSplatMeshes, sceneLayers, disposeSparkRenderer, primeSparkLayerSpy, hangState } =
  vi.hoisted(() => ({
    createdSplatMeshes: [] as Array<{ options: Record<string, unknown>; mesh: unknown }>,
    sceneLayers: [] as unknown[],
    disposeSparkRenderer: vi.fn(),
    primeSparkLayerSpy: vi.fn(async () => undefined),
    /** `hang` 置真时下一条网格永不完成（模拟 Spark worker 静默卡死） */
    hangState: { hang: false }
  }))

vi.mock('@sparkjsdev/spark', async () => {
  const THREE = await import('three')
  class FakeSplatMesh {
    name = ''
    userData: Record<string, unknown> = {}
    initialized: Promise<unknown>
    constructor(options: Record<string, unknown>) {
      this.initialized = hangState.hang ? new Promise<never>(() => {}) : Promise.resolve(this)
      createdSplatMeshes.push({ options, mesh: this })
    }
  }
  // 真 THREE.Object3D：SparkRenderer 就是 `extends THREE.Mesh`，
  // 场景增删走的就是这一套，假层也用同一基类才能反映真实生命周期
  class FakeSparkRenderer extends THREE.Object3D {
    dispose = disposeSparkRenderer
    update = primeSparkLayerSpy
    constructor(options: Record<string, unknown>) {
      super()
      sceneLayers.push(this)
      void options
    }
  }
  return { SplatMesh: FakeSplatMesh, SparkRenderer: FakeSparkRenderer }
})

const {
  GAUSSIAN_SPLAT_FLAG,
  SPLAT_EXTENSIONS,
  createSplatMesh,
  disposeSparkLayer,
  ensureSparkLayer,
  isGaussianSplatObject,
  isSplatPath,
  primeSparkLayer,
  splatObjectBounds
} = await import('../src/renderer/src/features/director/splatMesh')
const { loadModelScene } = await import('../src/renderer/src/features/director/loadModelScene')
const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js')

afterEach(() => {
  disposeSparkLayer()
  sceneLayers.length = 0
  createdSplatMeshes.length = 0
  disposeSparkRenderer.mockClear()
})

describe('isSplatPath', () => {
  it('recognizes both official splat artifact extensions', () => {
    expect(SPLAT_EXTENSIONS).toEqual(['.ply', '.spz'])
    expect(isSplatPath('Cache/Models/world.spz')).toBe(true)
    expect(isSplatPath('Assets/Models/world.ply')).toBe(true)
    expect(isSplatPath('C:/proj/Cache/Models/world.SPZ')).toBe(true)
  })

  it('ignores query / hash suffixes and rejects non-splat artifacts', () => {
    expect(isSplatPath('https://cdn.example.com/world.spz?sign=abc#x')).toBe(true)
    expect(isSplatPath('Cache/Models/world.glb')).toBe(false)
    expect(isSplatPath('Cache/Models/world.pano.png')).toBe(false)
    expect(isSplatPath('')).toBe(false)
  })
})

describe('createSplatMesh', () => {
  it('marks the splat so the stage material / shading pass can skip it', async () => {
    const object = await createSplatMesh({
      url: 'studio-media://local?path=world.spz',
      name: 'World Splat'
    })
    expect(createdSplatMeshes).toHaveLength(1)
    expect(createdSplatMeshes[0]!.options.url).toBe('studio-media://local?path=world.spz')
    expect(createdSplatMeshes[0]!.options.raycastable).toBe(true)
    expect(object.name).toBe('World Splat')
    expect(object.userData[GAUSSIAN_SPLAT_FLAG]).toBe(true)
    expect(isGaussianSplatObject(object)).toBe(true)
  })

  it('keeps the loader-assigned name when no name is passed, and never mislabels a model', async () => {
    const object = await createSplatMesh({ url: 'world.ply' })
    expect(object.name).toBe('')
    expect(isGaussianSplatObject(object)).toBe(true)
    expect(isGaussianSplatObject(null)).toBe(false)
    expect(isGaussianSplatObject(new THREE.Mesh())).toBe(false)
    expect(isGaussianSplatObject({ userData: { [GAUSSIAN_SPLAT_FLAG]: false } } as never)).toBe(
      false
    )
  })

  /**
   * Spark 的解析在 Web Worker 里做，静默失败时 `initialized` 会**永远 pending** ——
   * 界面表现就是一直「正在加载」、既不报错也不结束（画廊缩略图与 3D 预览一起卡死）。
   * 所以这里必须有「无进展即失败」的兜底，而不是无限等待。
   */
  it('fails instead of hanging forever when the load never settles', async () => {
    vi.useFakeTimers()
    try {
      // 这一条网格永远不完成
      hangState.hang = true
      const pending = createSplatMesh({ url: 'world.ply', stallTimeoutMs: 1000 })
      const assertion = expect(pending).rejects.toThrow(/stalled/i)
      await vi.advanceTimersByTimeAsync(1500)
      await assertion
    } finally {
      hangState.hang = false
      vi.useRealTimers()
    }
  })

  it('does not fire the stall guard when the load simply finishes', async () => {
    vi.useFakeTimers()
    try {
      const pending = createSplatMesh({ url: 'world.spz', stallTimeoutMs: 1000 })
      await vi.advanceTimersByTimeAsync(5000)
      await expect(pending).resolves.toBeTruthy()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('primeSparkLayer', () => {
  /**
   * 实测（scripts/splat-inspect）：不显式喂一次累加器时，着色器编译了、几何体也画了，
   * 但 `activeSplats` 恒为 0 —— 一个泼溅都没进累加器，画面接近空白。
   * 所有渲染路径（预览 / 缩略图 / 导演台）都必须在取景之后调它。
   */
  it('pushes the current scene + camera into the mounted Spark layer', async () => {
    const target = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera()
    await ensureSparkLayer({ scene: target, renderer: {} as THREE.WebGLRenderer })

    await expect(primeSparkLayer({ scene: target, camera })).resolves.toBe(true)
    expect(primeSparkLayerSpy).toHaveBeenCalledTimes(1)
    expect(primeSparkLayerSpy.mock.calls[0]![0]).toEqual({ scene: target, camera })
  })

  it('reports false when that scene has no Spark layer yet', async () => {
    await expect(
      primeSparkLayer({ scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera() })
    ).resolves.toBe(false)
  })
})

describe('splatObjectBounds', () => {
  /** 假泼溅：只实现取景真正用到的那一个方法 */
  function fakeSplat(box: THREE.Box3 | null, scale = 1): THREE.Object3D {
    const object = new THREE.Object3D()
    object.userData[GAUSSIAN_SPLAT_FLAG] = true
    object.scale.setScalar(scale)
    ;(object as unknown as { getBoundingBox: () => THREE.Box3 | null }).getBoundingBox = () =>
      box?.clone() ?? null
    return object
  }

  it('falls back to the splat bounds because setFromObject cannot measure one', () => {
    const splat = fakeSplat(
      new THREE.Box3(new THREE.Vector3(-1, 0, -2), new THREE.Vector3(1, 3, 2))
    )
    // 前提：three 自己对泼溅求到的是空盒（几何体由 Spark 在渲染前构造）
    expect(new THREE.Box3().setFromObject(splat).isEmpty()).toBe(true)

    const box = splatObjectBounds(splat)
    expect(box.isEmpty()).toBe(false)
    expect(box.min.toArray()).toEqual([-1, 0, -2])
    expect(box.max.toArray()).toEqual([1, 3, 2])
  })

  it('converts local splat bounds into world space', () => {
    const child = fakeSplat(new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 1, 1)))
    const root = new THREE.Group()
    root.position.set(10, 0, 0)
    root.add(child)
    const box = splatObjectBounds(root)
    expect(box.min.toArray()).toEqual([10, 0, 0])
    expect(box.max.toArray()).toEqual([11, 1, 1])
  })

  it('returns an empty box when there is no measurable splat', () => {
    expect(splatObjectBounds(new THREE.Group()).isEmpty()).toBe(true)
    expect(splatObjectBounds(fakeSplat(null)).isEmpty()).toBe(true)
  })
})

describe('loadModelScene splat routing', () => {
  it('routes .ply / .spz to Spark and leaves the glTF loader alone', async () => {
    const gltfSpy = vi
      .spyOn(GLTFLoader.prototype, 'loadAsync')
      .mockResolvedValue({ scene: new THREE.Group(), animations: [] } as never)
    try {
      const splat = await loadModelScene('studio-media://local?path=world.spz', 'Cache/world.spz')
      expect(isGaussianSplatObject(splat.scene)).toBe(true)
      expect(splat.animations).toEqual([])

      const ply = await loadModelScene('studio-media://local?path=world.ply', 'Cache/world.ply')
      expect(isGaussianSplatObject(ply.scene)).toBe(true)

      // 扩展名判定走 filePathHint（协议 URL 常常看不出后缀）
      expect(gltfSpy).not.toHaveBeenCalled()

      await loadModelScene('studio-media://local?path=hero.glb', 'Models/hero.glb')
      expect(gltfSpy).toHaveBeenCalledTimes(1)
    } finally {
      gltfSpy.mockRestore()
    }
  })
})

describe('ensureSparkLayer', () => {
  it('mounts the renderer layer into the scene exactly once, then disposes it', async () => {
    const target = new THREE.Scene()
    const renderer = {} as THREE.WebGLRenderer
    const first = await ensureSparkLayer({ scene: target, renderer })
    // 假渲染层与 Spark 同基类（THREE.Mesh → Object3D），add 之后确实在场景里
    expect((first as unknown as THREE.Object3D).parent).toBe(target)
    expect(target.children).toContain(first)
    expect(sceneLayers).toHaveLength(1)
    expect((first as unknown as THREE.Object3D).name).toBe('SparkSplatLayer')

    // 幂等：同一场景重复请求（含泼溅重建）不会反复挂层
    const again = await ensureSparkLayer({ scene: target, renderer })
    expect(again).toBe(first)
    expect(target.children).toHaveLength(1)
    expect(sceneLayers).toHaveLength(1)

    disposeSparkLayer()
    expect((first as unknown as THREE.Object3D).parent).toBe(null)
    expect(target.children).toHaveLength(0)
    expect(disposeSparkRenderer).toHaveBeenCalledTimes(1)
    // 重复释放是安全的（舞台卸载可能被调用多次）
    disposeSparkLayer()
    expect(disposeSparkRenderer).toHaveBeenCalledTimes(1)
  })

  /**
   * 导演台、3D 预览、缩略图摆拍可能同时存在：层必须按场景各一份，
   * 否则后挂上的那个会把先开预览的泼溅「带走」（那台变空）。
   */
  it('keeps one layer per scene instead of a single global one', async () => {
    const renderer = {} as THREE.WebGLRenderer
    const stage = new THREE.Scene()
    const preview = new THREE.Scene()

    const stageLayer = await ensureSparkLayer({ scene: stage, renderer })
    const previewLayer = await ensureSparkLayer({ scene: preview, renderer })
    expect(previewLayer).not.toBe(stageLayer)
    expect(stage.children).toContain(stageLayer)
    expect(preview.children).toContain(previewLayer)

    // 释放预览只摘预览那层，舞台不受影响
    disposeSparkLayer(preview)
    expect(preview.children).toHaveLength(0)
    expect(stage.children).toContain(stageLayer)

    // 不传场景 = 全量释放（舞台卸载兜底）
    disposeSparkLayer()
    expect(stage.children).toHaveLength(0)
    expect(disposeSparkRenderer).toHaveBeenCalledTimes(2)
  })
})
