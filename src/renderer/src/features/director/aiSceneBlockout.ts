import { DEFAULT_DIRECTOR_CAMERA_FOV } from '@shared/domain'
import type { StagePrimitive, StageVec3 } from '@shared/domain'
import { stripJsonCodeFence } from '@shared/graph'

export const BUILD_SCENE_FUNCTION_NAME = 'build_scene'

/** 与 useDirectorStageScene.makePrimitive 的内置尺寸保持一致 */
export interface StagePrimitiveSpec {
  primitive: StagePrimitive
  label: string
  baseSize: string
  hint: string
}

export const STAGE_PRIMITIVE_CATALOG: StagePrimitiveSpec[] = [
  { primitive: 'box', label: 'Box', baseSize: '1 x 1 x 1', hint: '家具/建筑/墙体等方体，用 scale 缩放' },
  { primitive: 'sphere', label: 'Sphere', baseSize: 'diameter 1', hint: '球形物体（灯罩、石头、树冠）' },
  { primitive: 'capsule', label: 'Capsule', baseSize: 'radius 0.5 + height 1 ≈ 2m', hint: '人形、栏杆；成人约 scale.y=0.85' },
  { primitive: 'cone', label: 'Cone', baseSize: '底直径 1, 高 1, 尖顶 +Y, 几何中心为原点', hint: '圆锥塔尖/锥形屋顶/尖顶；scale.x 必须等于 scale.z；rotation 通常为 0' },
  { primitive: 'pyramid', label: 'Pyramid', baseSize: 'square base 1, height 1, tip +Y', hint: '方锥屋顶、山花' },
  { primitive: 'cylinder', label: 'Cylinder', baseSize: '直径 1, 高 1, 轴向 +Y', hint: '圆形塔身、立柱；圆的用这个，不要用 prism' },
  { primitive: 'tube', label: 'Tube', baseSize: 'outer 0.5, inner 0.32, height 1', hint: '空心管、烟囱、井口、管道' },
  { primitive: 'prism', label: 'Prism', baseSize: 'hex, radius 0.5, height 1', hint: '仅当照片能数出六/八个平面时用；圆塔禁用' },
  { primitive: 'hemisphere', label: 'Hemisphere', baseSize: 'diameter 1, dome +Y', hint: '穹顶、拱顶、半球罩' },
  { primitive: 'torus', label: 'Torus', baseSize: 'major 0.35, tube 0.12, 竖立于 XY', hint: '完整圆环、轮、花环；不要拿它当城门拱' },
  { primitive: 'arch', label: 'Arch', baseSize: '跨度 1, 矢高 0.5, 进深约 0.3, 开口朝 ±Z', hint: '半圆券/拱门/拱桥肋；rotation 通常为 0，不要再转 90°' },
  { primitive: 'pointedArch', label: 'Pointed Arch', baseSize: '跨度 1, 矢高约 0.87, 进深约 0.3, 开口朝 ±Z', hint: '哥特尖拱/尖券（教堂门窗）；不要拿半圆 arch 代替尖拱' },
  { primitive: 'cross', label: 'Cross', baseSize: '高 1, 横臂 0.5, 厚 0.18, 正面朝 ±Z', hint: '拉丁十字架/教堂十字；竖直杆 + 上段横臂，立于塔尖/屋顶' },
  { primitive: 'tetrahedron', label: 'Tetrahedron', baseSize: 'radius 0.6', hint: '四面体（岩石、晶体碎块）' },
  { primitive: 'octahedron', label: 'Octahedron', baseSize: 'radius 0.5', hint: '八面体（宝石、装饰）' },
  { primitive: 'icosphere', label: 'Icosphere', baseSize: 'diameter 1, subdiv 1', hint: '低模圆石、树冠、不规则球体' },
  { primitive: 'wedge', label: 'Wedge', baseSize: '1 x 1 x 1 直角楔', hint: '坡道、台阶、斜屋顶、三角楣' },
  { primitive: 'disc', label: 'Disc', baseSize: 'diameter 1, 水平', hint: '圆台、水池、地面圆垫' },
  { primitive: 'ring', label: 'Ring', baseSize: 'outer 1, inner 0.56, 水平', hint: '花坛、圆窗框、地面环' },
  { primitive: 'plane', label: 'Plane', baseSize: '10 x 10', hint: '默认绕 X 轴 -90° 水平放置，适合地面' },
  { primitive: 'quad', label: 'Quad', baseSize: '1 x 1', hint: '单面薄片（标牌、屏幕）' }
]

const ALLOWED_PRIMITIVES = new Set<StagePrimitive>(STAGE_PRIMITIVE_CATALOG.map((item) => item.primitive))

function isStagePrimitive(value: string): value is StagePrimitive {
  return ALLOWED_PRIMITIVES.has(value as StagePrimitive)
}

const DEFAULT_BLOCKOUT_COLOR = '#c8ccd2'
const MAX_BLOCKOUT_OBJECTS = 120

export interface AiSceneBlockoutObject {
  name: string
  primitive: StagePrimitive
  color: string
  position: StageVec3
  rotation: StageVec3
  scale: StageVec3
  /** 等距柱状全景水平方位：0=画面中心，+右 / -左，单位度 */
  azimuthDeg?: number
  /** 相对视平线仰角，单位度；与 distance 一起用时覆盖 position */
  elevationDeg?: number
  /** 到观察者（原点）的距离，米 */
  distance?: number
}

export interface AiSceneBlockoutCall {
  name: typeof BUILD_SCENE_FUNCTION_NAME
  arguments: {
    objects: AiSceneBlockoutObject[]
    summary: string
  }
}

export interface BlockoutCameraContext {
  /** 垂直视场角（度）；缺省用导演台默认 FOV */
  fovDeg?: number
  /** 画幅宽高比（宽 / 高）；缺省 16:9 */
  aspectRatio?: number
  /** 相机（观察者）离地高度，米；缺省 1.6 */
  eyeHeight?: number
}

interface RawVec3Input {
  x: unknown
  y: unknown
  z: unknown
}

function clampNumber(value: unknown, min: number, max: number): number {
  const num = Number(value)
  if (!Number.isFinite(num)) return 0
  return Math.max(min, Math.min(max, num))
}

function readVec3(raw: unknown, limit: number): StageVec3 {
  const row = (raw ?? {}) as Partial<RawVec3Input>
  return {
    x: clampNumber(row.x, -limit, limit),
    y: clampNumber(row.y, -limit, limit),
    z: clampNumber(row.z, -limit, limit)
  }
}

function readScaleVec3(raw: unknown): StageVec3 {
  const row = (raw ?? {}) as Partial<RawVec3Input>
  const axis = (value: unknown): number => {
    const num = Number(value)
    if (!Number.isFinite(num)) return 1
    return Math.max(0.001, Math.min(10000, num))
  }
  return { x: axis(row.x), y: axis(row.y), z: axis(row.z) }
}

function readColor(raw: unknown): string {
  if (typeof raw !== 'string') return DEFAULT_BLOCKOUT_COLOR
  const hex = raw.trim()
  return /^#[0-9a-fA-F]{6}$/.test(hex) ? hex.toLowerCase() : DEFAULT_BLOCKOUT_COLOR
}

function readObjects(raw: unknown): AiSceneBlockoutObject[] {
  if (!Array.isArray(raw)) return []
  const out: AiSceneBlockoutObject[] = []
  for (const entry of raw.slice(0, MAX_BLOCKOUT_OBJECTS)) {
    if (!entry || typeof entry !== 'object') continue
    const row = entry as Record<string, unknown>
    const primitive = typeof row.primitive === 'string' ? row.primitive.trim() : ''
    if (!isStagePrimitive(primitive)) continue
    const name =
      typeof row.name === 'string' && row.name.trim()
        ? row.name.trim().slice(0, 40)
        : primitive
    const azimuthDeg = Number(row.azimuthDeg)
    const elevationDeg = Number(row.elevationDeg)
    const distance = Number(row.distance)
    out.push({
      name,
      primitive,
      color: readColor(row.color),
      position: readVec3(row.position, 1000),
      rotation: readVec3(row.rotation, Math.PI * 4),
      scale: readScaleVec3(row.scale),
      ...(Number.isFinite(azimuthDeg) ? { azimuthDeg } : {}),
      ...(Number.isFinite(elevationDeg) ? { elevationDeg } : {}),
      ...(Number.isFinite(distance) && distance > 0 ? { distance } : {})
    })
  }
  return out
}

/**
 * 解析模型返回的 function-call JSON。
 * 支持：
 * - `{ "name":"build_scene", "arguments": { "objects":[...], "summary":"..." } }`
 * - `{ "objects":[...] }`
 * - OpenAI 风格 `{ "tool_calls":[{ "function":{ "name","arguments": "..." }}] }`
 */
export function parseAiSceneBlockoutCall(raw: string | null | undefined): AiSceneBlockoutCall | null {
  if (!raw?.trim()) return null
  const text = stripJsonCodeFence(raw)
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start < 0 || end <= start) return null
    try {
      parsed = JSON.parse(text.slice(start, end + 1))
    } catch {
      return null
    }
  }
  if (!parsed || typeof parsed !== 'object') return null
  const root = parsed as Record<string, unknown>

  let argsObj: Record<string, unknown> | null = null
  if (Array.isArray(root.tool_calls) && root.tool_calls[0]) {
    const call = root.tool_calls[0] as Record<string, unknown>
    const fn = (call.function ?? call) as Record<string, unknown>
    const name = typeof fn.name === 'string' ? fn.name.trim() : ''
    if (name && name !== BUILD_SCENE_FUNCTION_NAME) return null
    let args: unknown = fn.arguments
    if (typeof args === 'string') {
      try {
        args = JSON.parse(args)
      } catch {
        args = null
      }
    }
    argsObj = args && typeof args === 'object' ? (args as Record<string, unknown>) : null
  } else {
    if (
      typeof root.name === 'string' &&
      root.name.trim() &&
      root.name.trim() !== BUILD_SCENE_FUNCTION_NAME
    ) {
      return null
    }
    argsObj =
      root.arguments && typeof root.arguments === 'object'
        ? (root.arguments as Record<string, unknown>)
        : root
  }

  if (!argsObj) return null
  const objects = readObjects(argsObj.objects)
  if (!objects.length) return null
  const summary = typeof argsObj.summary === 'string' ? argsObj.summary.trim().slice(0, 200) : ''
  return {
    name: BUILD_SCENE_FUNCTION_NAME,
    arguments: { objects, summary }
  }
}

export const MAX_BLOCKOUT_REFERENCE_IMAGES = 3

export type BlockoutLayoutMode = 'panorama' | 'perspective'

export interface BlockoutPanoramaContext {
  radius: number
  yawDeg: number
  mode: BlockoutLayoutMode
  /** 已把 360 全景展开成透视切片发给模型 */
  unwrapped?: boolean
}

/**
 * 等距柱状全景方位 → 舞台世界坐标。
 * 方位 0° = 全景图中心，+右 / -左。
 * 舞台 yaw=0 时：图中心落在 -X；图右侧 +90° 落在 -Z（默认相机朝向）。
 */
export function panoramaAzimuthToWorld(
  azimuthDeg: number,
  elevationDeg: number,
  distance: number,
  panoramaYawDeg: number
): StageVec3 {
  const d = Math.max(0.01, distance)
  const elev = (elevationDeg * Math.PI) / 180
  const worldYaw = ((azimuthDeg - 90 + panoramaYawDeg) * Math.PI) / 180
  const horiz = d * Math.cos(elev)
  return {
    x: horiz * Math.sin(worldYaw),
    y: d * Math.sin(elev),
    z: -horiz * Math.cos(worldYaw)
  }
}

/**
 * 把「把全景当一张透视照片、相机朝 -Z」的 xyz 扭到舞台：
 * 照片正前方 → 全景图中心（-X），再叠全景球水平旋转。
 */
export function photoSpaceToStageWorld(position: StageVec3, panoramaYawDeg: number): StageVec3 {
  const yaw = ((90 + panoramaYawDeg) * Math.PI) / 180
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  return {
    x: position.x * c + position.z * s,
    y: position.y,
    z: -position.x * s + position.z * c
  }
}

/** 透视图：方位 0° = 默认相机前方（-Z） */
export function perspectiveAzimuthToWorld(
  azimuthDeg: number,
  elevationDeg: number,
  distance: number
): StageVec3 {
  const d = Math.max(0.01, distance)
  const elev = (elevationDeg * Math.PI) / 180
  const yaw = (azimuthDeg * Math.PI) / 180
  const horiz = d * Math.cos(elev)
  return {
    x: horiz * Math.sin(yaw),
    y: d * Math.sin(elev),
    z: -horiz * Math.cos(yaw)
  }
}

export function resolveBlockoutWorldPosition(
  spec: AiSceneBlockoutObject,
  ctx: { mode: BlockoutLayoutMode; panoramaYawDeg?: number }
): StageVec3 {
  const yawDeg = ctx.panoramaYawDeg ?? 0
  if (spec.distance != null && spec.azimuthDeg != null) {
    const elev = spec.elevationDeg ?? 0
    if (ctx.mode === 'panorama') {
      const pos = panoramaAzimuthToWorld(spec.azimuthDeg, elev, spec.distance, yawDeg)
      if (spec.elevationDeg == null) pos.y = spec.position.y
      return pos
    }
    const pos = perspectiveAzimuthToWorld(spec.azimuthDeg, elev, spec.distance)
    if (spec.elevationDeg == null) pos.y = spec.position.y
    return pos
  }
  if (ctx.mode === 'panorama') return photoSpaceToStageWorld(spec.position, yawDeg)
  return spec.position
}

/**
 * 各实体几何「底面到中心」的垂直距离（未乘 scale）。
 * 只收录形状明确、通常会贴地的实体；arch/hemisphere/torus/plane/quad/disc/ring/tube
 * 要么悬空语义不明确，要么是薄片，不在这里接地。
 */
const GROUND_BASE_HALF_HEIGHT: Partial<Record<StagePrimitive, number>> = {
  box: 0.5,
  cylinder: 0.5,
  cone: 0.5,
  pyramid: 0.5,
  prism: 0.5,
  wedge: 0.5,
  sphere: 0.5,
  icosphere: 0.5,
  capsule: 1
}

/**
 * 计算贴地实体应处的中心高度（基座落在 y=0），单位为米。
 * 返回 null 表示该 primitive 不做自动接地处理。
 */
export function blockoutGroundedCenterY(spec: AiSceneBlockoutObject): number | null {
  const half = GROUND_BASE_HALF_HEIGHT[spec.primitive]
  if (half == null) return null
  const scaleY = Number.isFinite(spec.scale.y) ? spec.scale.y : 1
  return half * Math.max(0.001, scaleY)
}

/**
 * 接地纠偏：如果模型把贴地实体中心放到了基座线（或更低，即埋进地面），
 * 把它抬到「底面刚好落在 y=0」的高度；明显悬空的高 y 不动。
 * 返回新的 y 或 null（无需调整）。
 */
export function snapBlockoutToGround(
  spec: AiSceneBlockoutObject,
  y: number
): number | null {
  const groundedY = blockoutGroundedCenterY(spec)
  if (groundedY == null) return null
  if (y <= groundedY + 0.05) return groundedY
  return null
}

export function isLikelyEquirectangularSize(width: number, height: number): boolean {
  if (width < 8 || height < 4) return false
  const ratio = width / height
  // 等距柱状约 2:1；排除 16:9（~1.78）等常见透视照片
  return Math.abs(ratio - 2) <= 0.12
}

function primitiveCatalogText(zh: boolean): string {
  return STAGE_PRIMITIVE_CATALOG.map((item) =>
    zh
      ? `- ${item.primitive}（${item.label}）：基础尺寸 ${item.baseSize}；${item.hint}`
      : `- ${item.primitive} (${item.label}): base size ${item.baseSize}; ${item.hint}`
  ).join('\n')
}

function reconstructionRulesText(zh: boolean): string {
  if (zh) {
    return `还原目标（比“大块概括”更重要）：
- 对照参考图数清可见元素：塔楼、拱门/门洞、回廊开间、道路、人物、灌木都要各自出件，禁止把整面立面收成一块实心盒子。
- 弧线与锥顶必须用对的几何体，禁止用方块或棱柱去“近似”：
  - 半圆/圆拱/拱桥券体只用 arch。默认已立好：跨度沿 X，矢高沿 Y，开口朝相机（±Z）。position 是包围盒中心，rotation 用 {0,0,0}，不要再绕轴转 90°。scale.x=跨度，scale.y=矢高，scale.z=券厚。左右墩用 box/cylinder，中间必须留空。
  - 圆锥塔尖/尖顶只用 cone。尖顶朝 +Y，position 是锥体中心（不是锥尖）。scale.x 必须等于 scale.z（圆形底），scale.y 是锥高。直立塔尖 rotation 必须是 {0,0,0}。
  - 圆形塔身/圆柱只用 cylinder，不要用 prism。prism 只留给能数出六/八个平面的塔。
  - 哥特尖拱/尖券只用 pointedArch（只有半圆券才用 arch），不要用 arch 或 box 代替尖拱。
  - 十字架只用 cross：竖直杆朝 +Y、横臂在上段，立在塔尖/屋顶/钟楼顶。
- 禁止：用 box 当拱券或锥顶；用 wedge/tetrahedron 拼圆弧；用 prism 冒充圆柱；用 arch 冒充尖拱；用两个 box 拼十字架。
- 连拱廊：每个开间一根 arch + 柱墩，沿 -Z 重复。
- 塔楼 = 基座(box) + 圆塔身(cylinder) 或明确的棱塔(prism) + 锥顶(cone) 或方锥(pyramid)。穹顶用 hemisphere。
- wedge 只用于直坡：坡道、台阶、斜屋顶。圆形水池用 disc，花坛用 ring。
- 人物用 capsule，身高约 1.7m（scale 约 0.85），人数尽量与图中一致，用来校准建筑尺度。纪念性建筑塔高常 15–40m，道路宽 4–8m，不要缩成桌面沙盘。
- 颜色从参考图取样（石头、草地、衣服、屋顶），不要全部刷成灰色。
- 先铺地面和主轴线，再中景建筑，再远景塔群，最后人物和灌木。目标 40–${MAX_BLOCKOUT_OBJECTS} 个物体（复杂室外场景不要少于 30）。`
  }
  return `Fidelity beats massing:
- Count visible towers, arches, colonnade bays, path, people, shrubs. Never collapse a whole facade into one solid box.
- Curves and tapers must use the right primitive — never a box or prism stand-in:
  - Round arch / gate / bridge rib = arch only. It already stands: span X, rise Y, opening toward the camera (±Z). position = bbox center, rotation {0,0,0}, do NOT add a 90° tilt. scale.x=span, scale.y=rise, scale.z=rib depth. Piers = box/cylinder, VOID under the arch.
  - Circular spire = cone only. Tip is +Y. position is the cone CENTER, not the tip. scale.x MUST equal scale.z. Upright spires use rotation {0,0,0}.
  - Round shafts = cylinder, never prism. prism only if you can count 6/8 flat faces.
  - Gothic / pointed arch = pointedArch only (round arch = arch). Never substitute arch or a box for a pointed arch.
  - Cross = cross only: vertical shaft +Y, crossbar on the upper third, standing on spires/roofs/bell towers.
- Forbidden: box as an arch or spire; wedge/tetrahedron for a curve; prism pretending to be a cylinder; arch faking a pointed arch; two boxes pretending to be a cross.
- Colonnade: one arch + piers per bay, repeated along -Z.
- Tower = box plinth + cylinder (or true prism) + cone/pyramid cap. Domes = hemisphere.
- wedge is only for straight slopes: ramps, stairs, pitched roofs.
- People = capsule ~1.7m (scale ~0.85). Match the headcount; use them as the scale ruler. Monumental towers 15–40m, path 4–8m wide.
- Sample colors from the photo. Do not paint everything gray.
- Ground and axis first, then midground, then distant towers, then people. Target 40–${MAX_BLOCKOUT_OBJECTS} objects (complex exteriors at least 30).`
}

function cameraFrameText(zh: boolean, camera: BlockoutCameraContext): string {
  const fov = Number.isFinite(camera.fovDeg) ? Number(camera.fovDeg) : DEFAULT_DIRECTOR_CAMERA_FOV
  const aspect = Number.isFinite(camera.aspectRatio) ? Number(camera.aspectRatio) : 16 / 9
  const eye = Number.isFinite(camera.eyeHeight) ? Number(camera.eyeHeight) : 1.6
  const aspectLabel = aspect.toFixed(2).replace(/\.?0+$/, '')
  if (zh) {
    return `相机与画面（务必据此摆放，否则透视对不上）：
- 相机位于 (0, ${eye}, 0) 朝 -Z：画面中心 = 前方 -Z，画面右侧 = +X；地面 y=0，Y 向上，单位米。
- 垂直视场角 FOV ≈ ${fov}°，画幅宽高比 ${aspectLabel}:1。参考图近似由这台相机拍摄，物体必须落在同一画面内：越近越大、越远越小。
- 视平线（地平线）高度 = 相机高度 ${eye}m。先在图里找到视平线：贴地物体的基座都应低于视平线，只有真实悬空的物体才高于视平线。`
  }
  return `Camera & frame (obey these or the perspective will not line up):
- Camera at (0, ${eye}, 0) looking down -Z: image center = -Z, image right = +X; ground y=0, Y-up, meters.
- Vertical FOV ≈ ${fov}°, aspect ${aspectLabel}:1. Treat the reference as shot by this camera; objects must fall in the same frame: closer = larger, farther = smaller.
- The horizon sits at camera height ${eye}m. Find it in the photo first: grounded objects sit below the horizon; only truly elevated objects rise above it.`
}

function scaleCalibrationText(zh: boolean): string {
  if (zh) {
    return `尺寸标定（用真实世界尺寸，别缩成桌面沙盘）：
- 成人 1.7m（capsule scale.y≈0.85）；门 2–2.2m；层高 3–3.5m；轿车高 1.4–1.5m；路宽 4–8m；栏杆 0.9–1.1m；台阶 0.15–0.18m。
- 用图中的人/门/车等已知尺度反推建筑：纪念性塔高 15–40m，普通住宅 6–12m，树冠 3–8m。`
  }
  return `Size calibration (use real-world meters, not a toy-scale diorama):
- Adult 1.7m (capsule scale.y≈0.85); door 2–2.2m; story 3–3.5m; car 1.4–1.5m; road 4–8m; railing 0.9–1.1m; step 0.15–0.18m.
- Infer building size from people/doors/cars in the photo: monumental towers 15–40m, houses 6–12m, tree crowns 3–8m.`
}

function groundingRulesText(zh: boolean): string {
  if (zh) {
    return `接地规则（position 是物体中心，不是底面）：
- 凡贴地的实体，基座必须落在 y=0：position.y = 高度一半。例如高 6m 的方柱 scale.y=6 → position.y=3。
- capsule 人物双脚踩地：scale.y=0.85 时 position.y≈0.85。
- 只有真实悬空物（吊灯、飞檐、树冠、招牌）才把 y 抬高；不要把墙/柱浮在半空，也不要全部压到 y=0 埋进地面。`
  }
  return `Grounding (position is the object CENTER, not its base):
- Grounded solids must rest on y=0: position.y = half height. E.g. a 6m box column (scale.y=6) → position.y=3.
- capsule people stand on the ground: scale.y=0.85 → position.y≈0.85.
- Only truly floating things (pendant lamps, eaves, tree crowns, signs) are lifted. Do not float walls/columns; do not bury objects at y=0.`
}

export function buildSceneBlockoutSystemPrompt(
  locale: string,
  mode: BlockoutLayoutMode = 'perspective',
  camera: BlockoutCameraContext = {}
): string {
  const zh = !locale.toLowerCase().startsWith('en')
  const catalog = primitiveCatalogText(zh)
  const fidelity = reconstructionRulesText(zh)
  const cameraFrame = cameraFrameText(zh, camera)
  const scaleCalibration = scaleCalibrationText(zh)
  const groundingRules = groundingRulesText(zh)
  if (mode === 'panorama') {
    if (zh) {
      return `你是影视/游戏前期可视化（Blockout / 白模）助手。当前参考是 360° 等距柱状全景（约 2:1），也可能已展开成左/中/右透视切片。请尽量还原图中能看到的形体与层次，只用下面的基础几何体搭场景。

可用几何体目录（primitive 字段只能取这些值）：
${catalog}

这是 360° 全景，不是一张透视照片：
- 观察者站在原点 (0,0,0)，视高约 1.6m，地面 y=0，单位米，Y 向上。
- 全景图水平：左缘 -180°、中心 0°、右缘 +180°；垂直：顶 +90°、视平线 0°、底 -90°。
- 物体必须围在观察者四周（前/后/左/右都要有），禁止把所有东西堆在「相机正前方几米」的一个锥里。
- 室内家具距离通常 1.5–6m；室外建筑/树木按 8–80m。
- 全景球半径会在用户指令中给出；物体距离必须小于 0.85×半径。

${scaleCalibration}

${groundingRules}

${fidelity}

规则：
1. 只输出一个 JSON 对象，不要 markdown，不要解释。
2. JSON 必须是 function call。优先用方位放置：
{"name":"build_scene","arguments":{"summary":"一句话概括","objects":[{"name":"门墩","primitive":"box","color":"#8a7a66","azimuthDeg":20,"elevationDeg":-12,"distance":8,"rotation":{"x":0,"y":0,"z":0},"scale":{"x":2,"y":6,"z":2}}]}}
3. azimuthDeg：全景图/中心切片中的水平方位（0=画面中心，+右，-左）。elevationDeg：相对视平线。distance：到原点的距离（米）。
4. scale 是相对基础尺寸的倍数（box 基础 1×1×1 米）。若同时给了 azimuthDeg+distance，以方位为准。
5. rotation 为弧度欧拉角 XYZ。
6. color 使用 #rrggbb。
7. 物体不超过 ${MAX_BLOCKOUT_OBJECTS} 个。不要输出目录外 primitive。`
    }
    return `You are a previz / blockout assistant. The reference is a 360° equirectangular panorama (~2:1), sometimes unwrapped into left/center/right slices. Rebuild what is visible using ONLY these primitives:

${catalog}

This is a 360° panorama, NOT a perspective photo:
- Viewer at origin (0,0,0), eye height ~1.6m, ground y=0, meters, Y-up.
- Longitude: left -180°, center 0°, right +180°. Place objects all around the viewer.
- Indoor furniture typically 1.5–6m; outdoor buildings 8–80m. Distance < 0.85× sphere radius.

${scaleCalibration}

${groundingRules}

${fidelity}

Rules:
1. Output ONE JSON function call only.
2. Prefer azimuth placement:
{"name":"build_scene","arguments":{"summary":"one line","objects":[{"name":"pier","primitive":"box","color":"#8a7a66","azimuthDeg":20,"elevationDeg":-12,"distance":8,"rotation":{"x":0,"y":0,"z":0},"scale":{"x":2,"y":6,"z":2}}]}}
3. azimuthDeg 0 = panorama center, +=right. scale multiplies base size (box 1×1×1m).
4. At most ${MAX_BLOCKOUT_OBJECTS} objects.`
  }
  if (zh) {
    return `你是影视/游戏前期可视化（Blockout / 白模）助手。当前参考是普通透视照片（或概念图）。目标是尽量还原画面里的轮廓、比例、进深和重复构件，而不是画一张示意沙盘。

可用几何体目录（primitive 字段只能取这些值）：
${catalog}

这是透视参考图，不是 360 全景：
- 舞台 Y 向上，单位米，地面 y=0。position 是物体中心。
- 近景 z≈-4～-12，中景 z≈-15～-40，远景塔楼可到 -80。单点透视的道路/中轴沿 -Z 拉长。
- 图面对称就左右对称摆。只摆照片里能看到的范围，不要围成一圈。

${cameraFrame}

${scaleCalibration}

${groundingRules}

${fidelity}

规则：
1. 只输出一个 JSON 对象，不要 markdown，不要解释。
2. JSON 必须是 function call：
{"name":"build_scene","arguments":{"summary":"一句话概括","objects":[{"name":"左门墩","primitive":"box","color":"#8a7a66","position":{"x":-4,"y":6,"z":-28},"rotation":{"x":0,"y":0,"z":0},"scale":{"x":3,"y":12,"z":3}}]}}
3. scale 是相对基础尺寸的倍数（box 基础 1×1×1 米）。
4. rotation 为弧度欧拉角 XYZ。
5. color 使用 #rrggbb。
6. 物体不超过 ${MAX_BLOCKOUT_OBJECTS} 个。不要输出目录外 primitive。`
  }
  return `You are a previz / blockout assistant. The reference is a normal perspective photo (or concept art). Match silhouette, proportion, depth, and repeating parts — not a toy-scale diagram.

${catalog}

This is a perspective plate, NOT a 360° panorama:
- Y-up, meters, ground y=0. position is the object center.
- Foreground z ≈ -4 to -12, midground -15 to -40, distant towers to -80. A one-point path runs along -Z.
- If the photo is symmetrical, place left/right pairs. Only build what the photo shows.

${cameraFrame}

${scaleCalibration}

${groundingRules}

${fidelity}

Rules:
1. Output ONE JSON function call only.
2. Shape:
{"name":"build_scene","arguments":{"summary":"one line","objects":[{"name":"left pier","primitive":"box","color":"#8a7a66","position":{"x":-4,"y":6,"z":-28},"rotation":{"x":0,"y":0,"z":0},"scale":{"x":3,"y":12,"z":3}}]}}
3. scale multiplies base size (box 1×1×1m).
4. At most ${MAX_BLOCKOUT_OBJECTS} objects.`
}

export function buildSceneBlockoutUserPrompt(input: {
  instruction: string
  imageCount: number
  mode?: BlockoutLayoutMode
  panoramaRadius?: number
  panoramaYawDeg?: number
  unwrapped?: boolean
  fovDeg?: number
  aspectRatio?: number
  eyeHeight?: number
}): string {
  const mode = input.mode ?? 'perspective'
  const lines = [
    'User instruction:',
    input.instruction.trim(),
    '',
    `Attached images: ${Math.max(1, input.imageCount)}.`,
    `Layout mode: ${mode}.`
  ]
  const fov = Number.isFinite(input.fovDeg) ? Number(input.fovDeg) : DEFAULT_DIRECTOR_CAMERA_FOV
  const aspect = Number.isFinite(input.aspectRatio) ? Number(input.aspectRatio) : 16 / 9
  const eye = Number.isFinite(input.eyeHeight) ? Number(input.eyeHeight) : 1.6
  if (mode === 'panorama') {
    const radius = Number.isFinite(input.panoramaRadius) ? Number(input.panoramaRadius) : 500
    const yaw = Number.isFinite(input.panoramaYawDeg) ? Number(input.panoramaYawDeg) : 0
    lines.push(
      `360 panorama sphere radius: ${radius} meters. Current panorama yaw: ${yaw} degrees (applied locally; output azimuthDeg in IMAGE space, 0 = panorama center).`,
      `Place objects around the viewer. Typical indoor distance 1.5–6m; keep distance < ${(radius * 0.85).toFixed(0)}m.`,
      `Viewer eye height: ${eye} m, ground y=0.`
    )
    if (input.unwrapped) {
      lines.push(
        'Images are perspective slices unwrapped from the 360 panorama: 1=center (azimuth 0), 2=left (azimuth -90), 3=right (azimuth +90).'
      )
    }
  } else {
    lines.push(
      'Treat attached images as perspective photos. Place objects in front of the camera (negative Z).',
      'Match silhouette, depth layers, repeating bays, and people count. Round arches = arch (rotation 0, opening ±Z). Circular spires = cone (tip +Y, scale.x=scale.z). Round towers = cylinder, not prism. Never fake a curve or cone with boxes. Do not wrap 360° around the origin.',
      `Camera: position (0, ${eye}, 0) looking down -Z; vertical FOV ≈ ${fov}°; aspect ≈ ${aspect.toFixed(2).replace(/\.?0+$/, '')}:1. Ground objects rest on y=0 (position.y = half height).`
    )
  }
  lines.push(`Return the ${BUILD_SCENE_FUNCTION_NAME} function call JSON now.`)
  return lines.join('\n')
}
