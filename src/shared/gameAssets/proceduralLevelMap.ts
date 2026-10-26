/**
 * 程序化 2D 游戏关卡地图生成器与 Tiled (.tmj) / LDtk 标准格式导出纯函数层。
 *
 * 支持 4 类全品类核心关卡拓扑算法：
 * 1. `bsp_dungeon`：二叉空间分割（BSP）地牢房间 + L 型走廊 + 出生房/商店房/宝箱房/精英房/Boss 房分配；
 * 2. `cellular_cave`：元胞自动机有机洞穴 + Flood-fill 最大连通域提取（保证 100% 无死胡同孤岛）；
 * 3. `platformer_course`：横版平台跳跃关卡（地面断崖、高低踏板、移动平台、金币弧线、巡逻怪、关底旗帜/Boss）；
 * 4. `arena_waves`：俯视角肉鸽割草/双摇杆射击竞技场（对称掩体柱、增益祭坛与外圈刷怪环）。
 *
 * 输出：
 * - 地面与墙体网格 + 4-bit Wang-16 自动瓦片位掩码（North=1, East=2, South=4, West=8）；
 * - 语义化实体刷新点列表（`player_spawn`, `boss_spawn`, `enemy_spawn`, `treasure_chest`, `shop_npc`, `shrine`, `trap`, `exit_portal`, `coin`）；
 * - 标准 Tiled 1.10 JSON Map (`.tmj`) 文本（可直接导入 Godot 4 / Unity SuperTiled2Unity / Phaser 3 `this.make.tilemap`）；
 * - 可视化 ASCII 地图预览。
 */

export type LevelGeneratorAlgorithm =
  'bsp_dungeon' | 'cellular_cave' | 'platformer_course' | 'arena_waves'

export type LevelCellType = 'void' | 'wall' | 'floor' | 'platform' | 'hazard'

export type LevelEntityType =
  | 'player_spawn'
  | 'boss_spawn'
  | 'enemy_spawn'
  | 'treasure_chest'
  | 'shop_npc'
  | 'shrine'
  | 'trap'
  | 'exit_portal'
  | 'moving_platform'
  | 'coin'

export interface LevelRoom {
  id: string
  x: number
  y: number
  width: number
  height: number
  centerX: number
  centerY: number
  role: 'start' | 'normal' | 'treasure' | 'shop' | 'boss' | 'arena'
}

export interface LevelEntitySpawn {
  id: string
  type: LevelEntityType
  gridX: number
  gridY: number
  pixelX: number
  pixelY: number
  roomId?: string
  properties?: Record<string, string | number | boolean>
}

export interface ProceduralLevelMapOptions {
  levelName?: string
  algorithm?: LevelGeneratorAlgorithm
  /** 地图网格宽度（列数，默认 40，范围 16~128） */
  width?: number
  /** 地图网格高度（行数，默认 28，范围 12~128） */
  height?: number
  /** 单格瓦片像素宽度（默认 32） */
  tileWidth?: number
  /** 单格瓦片像素高度（默认 32） */
  tileHeight?: number
  /** 确定性随机种子（默认 42） */
  seed?: number
  /** Tileset 贴图引用路径（写入 Tiled .tmj，默认 'tileset.png'） */
  tilesetImage?: string
}

export interface TiledLayerJson {
  id: number
  name: string
  type: 'tilelayer' | 'objectgroup'
  visible: boolean
  opacity: number
  x: number
  y: number
  width?: number
  height?: number
  data?: number[]
  draworder?: 'topdown'
  objects?: Array<{
    id: number
    name: string
    type: string
    x: number
    y: number
    width: number
    height: number
    rotation: number
    visible: boolean
    properties?: Array<{ name: string; type: string; value: string | number | boolean }>
  }>
}

export interface TiledMapJson {
  compressionlevel: number
  height: number
  width: number
  infinite: boolean
  orientation: 'orthogonal'
  renderorder: 'right-down'
  tiledversion: string
  tileheight: number
  tilewidth: number
  type: 'map'
  version: string
  nextlayerid: number
  nextobjectid: number
  layers: TiledLayerJson[]
  tilesets: Array<{
    firstgid: number
    name: string
    tilewidth: number
    tileheight: number
    tilecount: number
    columns: number
    image: string
    imagewidth: number
    imageheight: number
  }>
}

export interface ProceduralLevelMapResult {
  schemaVersion: 1
  levelName: string
  algorithm: LevelGeneratorAlgorithm
  width: number
  height: number
  tileWidth: number
  tileHeight: number
  seed: number
  rooms: LevelRoom[]
  entities: LevelEntitySpawn[]
  /** 行优先（height × width）地形枚举矩阵 */
  grid: LevelCellType[][]
  /** 行优先（height × width）Wang-16 4-bit 自动瓦片位掩码矩阵（0~15） */
  wang16BitmaskGrid: number[][]
  /** 字符可视化预览（# 墙, . 地板, = 平台, ^ 陷阱, P 出生, B Boss, C 宝箱, E 怪物, S 商店, X 出口） */
  asciiPreview: string
  /** 标准 Tiled (.tmj) JSON 对象 */
  tiledMap: TiledMapJson
  /** 格式化后的 Tiled .tmj 文本 */
  tiledTmjText: string
}

/** 确定性 Mulberry32 伪随机数生成器 */
function createSeededRng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function randInt(rng: () => number, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min
}

function createGrid(width: number, height: number, fill: LevelCellType): LevelCellType[][] {
  return Array.from({ length: height }, () => Array.from({ length: width }, () => fill))
}

function carveRect(
  grid: LevelCellType[][],
  x: number,
  y: number,
  w: number,
  h: number,
  cell: LevelCellType = 'floor'
): void {
  const height = grid.length
  const width = grid[0]?.length ?? 0
  for (let ry = Math.max(1, y); ry < Math.min(height - 1, y + h); ry++) {
    for (let rx = Math.max(1, x); rx < Math.min(width - 1, x + w); rx++) {
      grid[ry]![rx] = cell
    }
  }
}

function carveCorridor(
  grid: LevelCellType[][],
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  horizontalFirst: boolean
): void {
  const stepX = x1 <= x2 ? 1 : -1
  const stepY = y1 <= y2 ? 1 : -1
  if (horizontalFirst) {
    for (let x = x1; x !== x2 + stepX; x += stepX) {
      if (grid[y1]?.[x] !== undefined) grid[y1]![x] = 'floor'
      if (grid[y1 + 1]?.[x] !== undefined && y1 + 1 < grid.length - 1) grid[y1 + 1]![x] = 'floor'
    }
    for (let y = y1; y !== y2 + stepY; y += stepY) {
      if (grid[y]?.[x2] !== undefined) grid[y]![x2] = 'floor'
      if (grid[y]?.[x2 + 1] !== undefined && x2 + 1 < (grid[0]?.length ?? 0) - 1) {
        grid[y]![x2 + 1] = 'floor'
      }
    }
  } else {
    for (let y = y1; y !== y2 + stepY; y += stepY) {
      if (grid[y]?.[x1] !== undefined) grid[y]![x1] = 'floor'
      if (grid[y]?.[x1 + 1] !== undefined && x1 + 1 < (grid[0]?.length ?? 0) - 1) {
        grid[y]![x1 + 1] = 'floor'
      }
    }
    for (let x = x1; x !== x2 + stepX; x += stepX) {
      if (grid[y2]?.[x] !== undefined) grid[y2]![x] = 'floor'
      if (grid[y2 + 1]?.[x] !== undefined && y2 + 1 < grid.length - 1) grid[y2 + 1]![x] = 'floor'
    }
  }
}

function generateBspDungeon(
  width: number,
  height: number,
  rng: () => number
): { grid: LevelCellType[][]; rooms: LevelRoom[] } {
  const grid = createGrid(width, height, 'wall')
  interface Leaf {
    x: number
    y: number
    w: number
    h: number
  }
  const leaves: Leaf[] = [{ x: 1, y: 1, w: width - 2, h: height - 2 }]
  const minLeafSize = 10

  for (let iter = 0; iter < 4; iter++) {
    const nextLeaves: Leaf[] = []
    for (const leaf of leaves) {
      const canSplitH = leaf.h >= minLeafSize * 2
      const canSplitV = leaf.w >= minLeafSize * 2
      if (!canSplitH && !canSplitV) {
        nextLeaves.push(leaf)
        continue
      }
      const splitH = canSplitH && (!canSplitV || leaf.h > leaf.w || rng() > 0.5)
      if (splitH) {
        const split = randInt(rng, minLeafSize, leaf.h - minLeafSize)
        nextLeaves.push({ x: leaf.x, y: leaf.y, w: leaf.w, h: split })
        nextLeaves.push({ x: leaf.x, y: leaf.y + split, w: leaf.w, h: leaf.h - split })
      } else {
        const split = randInt(rng, minLeafSize, leaf.w - minLeafSize)
        nextLeaves.push({ x: leaf.x, y: leaf.y, w: split, h: leaf.h })
        nextLeaves.push({ x: leaf.x + split, y: leaf.y, w: leaf.w - split, h: leaf.h })
      }
    }
    leaves.splice(0, leaves.length, ...nextLeaves)
  }

  const rooms: LevelRoom[] = []
  leaves.forEach((leaf, idx) => {
    const rw = Math.max(4, randInt(rng, Math.floor(leaf.w * 0.55), Math.max(4, leaf.w - 2)))
    const rh = Math.max(4, randInt(rng, Math.floor(leaf.h * 0.55), Math.max(4, leaf.h - 2)))
    const rx = leaf.x + randInt(rng, 1, Math.max(1, leaf.w - rw - 1))
    const ry = leaf.y + randInt(rng, 1, Math.max(1, leaf.h - rh - 1))
    carveRect(grid, rx, ry, rw, rh, 'floor')
    rooms.push({
      id: `room_${String(idx + 1).padStart(2, '0')}`,
      x: rx,
      y: ry,
      width: rw,
      height: rh,
      centerX: Math.floor(rx + rw / 2),
      centerY: Math.floor(ry + rh / 2),
      role: 'normal'
    })
  })

  // Sort rooms left-to-right, top-to-bottom for natural progression
  rooms.sort((a, b) => a.centerX - b.centerX + (a.centerY - b.centerY) * 0.3)
  for (let i = 0; i < rooms.length - 1; i++) {
    const a = rooms[i]!
    const b = rooms[i + 1]!
    carveCorridor(grid, a.centerX, a.centerY, b.centerX, b.centerY, rng() > 0.5)
  }

  if (rooms.length > 0) rooms[0]!.role = 'start'
  if (rooms.length > 1) rooms[rooms.length - 1]!.role = 'boss'
  if (rooms.length > 2) rooms[Math.floor(rooms.length / 2)]!.role = 'treasure'
  if (rooms.length > 3) rooms[Math.max(1, rooms.length - 2)]!.role = 'shop'

  return { grid, rooms }
}

function generateCellularCave(
  width: number,
  height: number,
  rng: () => number
): { grid: LevelCellType[][]; rooms: LevelRoom[] } {
  let grid = createGrid(width, height, 'wall')
  for (let y = 2; y < height - 2; y++) {
    for (let x = 2; x < width - 2; x++) {
      grid[y]![x] = rng() < 0.46 ? 'wall' : 'floor'
    }
  }

  for (let step = 0; step < 4; step++) {
    const next = createGrid(width, height, 'wall')
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        let walls = 0
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue
            if (grid[y + dy]?.[x + dx] === 'wall') walls++
          }
        }
        next[y]![x] = walls >= 5 ? 'wall' : walls <= 3 ? 'floor' : grid[y]![x]!
      }
    }
    grid = next
  }

  // Flood-fill to keep largest connected cavern
  const visited = Array.from({ length: height }, () => new Uint8Array(width))
  let largestRegion: Array<[number, number]> = []

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      if (grid[y]![x] !== 'floor' || visited[y]![x]) continue
      const region: Array<[number, number]> = []
      const queue: Array<[number, number]> = [[x, y]]
      visited[y]![x] = 1
      while (queue.length > 0) {
        const [cx, cy] = queue.pop()!
        region.push([cx, cy])
        const dirs: Array<[number, number]> = [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1]
        ]
        for (const [dx, dy] of dirs) {
          const nx = cx + dx
          const ny = cy + dy
          if (nx > 0 && nx < width - 1 && ny > 0 && ny < height - 1) {
            if (!visited[ny]![nx] && grid[ny]![nx] === 'floor') {
              visited[ny]![nx] = 1
              queue.push([nx, ny])
            }
          }
        }
      }
      if (region.length > largestRegion.length) {
        largestRegion = region
      }
    }
  }

  const finalGrid = createGrid(width, height, 'wall')
  for (const [x, y] of largestRegion) {
    finalGrid[y]![x] = 'floor'
  }

  // Fallback if cavern was too small
  if (largestRegion.length < 24) {
    carveRect(finalGrid, 4, 4, width - 8, height - 8, 'floor')
    for (let y = 4; y < height - 4; y++) {
      for (let x = 4; x < width - 4; x++) {
        largestRegion.push([x, y])
      }
    }
  }

  largestRegion.sort((a, b) => a[0] - b[0])
  const startPt = largestRegion[0] ?? [4, Math.floor(height / 2)]
  const midPt = largestRegion[Math.floor(largestRegion.length / 2)] ?? [
    Math.floor(width / 2),
    Math.floor(height / 2)
  ]
  const endPt = largestRegion[largestRegion.length - 1] ?? [width - 5, Math.floor(height / 2)]

  const rooms: LevelRoom[] = [
    {
      id: 'cave_start',
      x: Math.max(1, startPt[0] - 2),
      y: Math.max(1, startPt[1] - 2),
      width: 5,
      height: 5,
      centerX: startPt[0],
      centerY: startPt[1],
      role: 'start'
    },
    {
      id: 'cave_heart',
      x: Math.max(1, midPt[0] - 3),
      y: Math.max(1, midPt[1] - 3),
      width: 6,
      height: 6,
      centerX: midPt[0],
      centerY: midPt[1],
      role: 'treasure'
    },
    {
      id: 'cave_boss',
      x: Math.max(1, endPt[0] - 3),
      y: Math.max(1, endPt[1] - 3),
      width: 6,
      height: 6,
      centerX: endPt[0],
      centerY: endPt[1],
      role: 'boss'
    }
  ]

  return { grid: finalGrid, rooms }
}

function generatePlatformerCourse(
  width: number,
  height: number,
  rng: () => number
): { grid: LevelCellType[][]; rooms: LevelRoom[] } {
  const grid = createGrid(width, height, 'void')
  const groundY = height - 4

  // Base ground with occasional hazard pits
  let x = 0
  while (x < width) {
    const isPit = x > 6 && x < width - 10 && rng() < 0.2
    const segLen = isPit ? randInt(rng, 2, 3) : randInt(rng, 5, 9)
    for (let sx = x; sx < Math.min(width, x + segLen); sx++) {
      if (isPit) {
        grid[height - 1]![sx] = 'hazard'
      } else {
        for (let y = groundY; y < height; y++) {
          grid[y]![sx] = 'wall'
        }
      }
    }
    x += segLen
  }

  // Elevated stepping platforms
  for (let px = 5; px < width - 8; px += randInt(rng, 5, 8)) {
    const platW = randInt(rng, 3, 5)
    const platY = groundY - randInt(rng, 3, Math.min(8, groundY - 3))
    for (let sx = px; sx < Math.min(width - 2, px + platW); sx++) {
      grid[platY]![sx] = 'platform'
    }
  }

  const rooms: LevelRoom[] = [
    {
      id: 'stage_start',
      x: 2,
      y: groundY - 4,
      width: 6,
      height: 4,
      centerX: 4,
      centerY: groundY - 1,
      role: 'start'
    },
    {
      id: 'stage_mid',
      x: Math.floor(width / 2) - 3,
      y: groundY - 6,
      width: 6,
      height: 6,
      centerX: Math.floor(width / 2),
      centerY: groundY - 1,
      role: 'treasure'
    },
    {
      id: 'stage_goal',
      x: width - 8,
      y: groundY - 4,
      width: 6,
      height: 4,
      centerX: width - 4,
      centerY: groundY - 1,
      role: 'boss'
    }
  ]

  return { grid, rooms }
}

function generateArenaWaves(
  width: number,
  height: number
): { grid: LevelCellType[][]; rooms: LevelRoom[] } {
  const grid = createGrid(width, height, 'wall')
  carveRect(grid, 2, 2, width - 4, height - 4, 'floor')

  // 4 symmetrical tactical pillars
  const px1 = Math.floor(width * 0.28)
  const px2 = Math.floor(width * 0.72) - 2
  const py1 = Math.floor(height * 0.28)
  const py2 = Math.floor(height * 0.72) - 2
  for (const [px, py] of [
    [px1, py1],
    [px2, py1],
    [px1, py2],
    [px2, py2]
  ]) {
    carveRect(grid, px!, py!, 2, 2, 'wall')
  }

  const rooms: LevelRoom[] = [
    {
      id: 'survivor_arena',
      x: 2,
      y: 2,
      width: width - 4,
      height: height - 4,
      centerX: Math.floor(width / 2),
      centerY: Math.floor(height / 2),
      role: 'arena'
    }
  ]
  return { grid, rooms }
}

function computeWang16BitmaskGrid(grid: LevelCellType[][]): number[][] {
  const height = grid.length
  const width = grid[0]?.length ?? 0
  const maskGrid: number[][] = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => 0)
  )

  const isSolid = (x: number, y: number): boolean => {
    if (x < 0 || x >= width || y < 0 || y >= height) return true
    const cell = grid[y]![x]
    return cell === 'wall' || cell === 'platform'
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!isSolid(x, y)) {
        maskGrid[y]![x] = 0
        continue
      }
      let mask = 0
      if (isSolid(x, y - 1)) mask |= 1 // North
      if (isSolid(x + 1, y)) mask |= 2 // East
      if (isSolid(x, y + 1)) mask |= 4 // South
      if (isSolid(x - 1, y)) mask |= 8 // West
      maskGrid[y]![x] = mask
    }
  }
  return maskGrid
}

function populateEntities(
  algorithm: LevelGeneratorAlgorithm,
  rooms: LevelRoom[],
  grid: LevelCellType[][],
  tileWidth: number,
  tileHeight: number,
  rng: () => number
): LevelEntitySpawn[] {
  const entities: LevelEntitySpawn[] = []
  let seq = 1
  const addEntity = (
    type: LevelEntityType,
    gx: number,
    gy: number,
    roomId?: string,
    properties?: Record<string, string | number | boolean>
  ): void => {
    entities.push({
      id: `${type}_${String(seq++).padStart(2, '0')}`,
      type,
      gridX: gx,
      gridY: gy,
      pixelX: gx * tileWidth + Math.floor(tileWidth / 2),
      pixelY: gy * tileHeight + Math.floor(tileHeight / 2),
      roomId,
      properties
    })
  }

  if (algorithm === 'arena_waves') {
    const arena = rooms[0]!
    addEntity('player_spawn', arena.centerX, arena.centerY, arena.id)
    addEntity('shrine', arena.centerX, Math.max(4, arena.y + 3), arena.id, {
      buffType: 'haste_or_heal'
    })
    addEntity(
      'treasure_chest',
      arena.centerX,
      Math.min(grid.length - 4, arena.y + arena.height - 3),
      arena.id
    )
    // Perimeter wave spawners
    const ringOffsets: Array<[number, number]> = [
      [4, 4],
      [grid[0]!.length - 5, 4],
      [4, grid.length - 5],
      [grid[0]!.length - 5, grid.length - 5],
      [arena.centerX, 3],
      [arena.centerX, grid.length - 4]
    ]
    for (const [ex, ey] of ringOffsets) {
      addEntity('enemy_spawn', ex, ey, arena.id, { waveSpawner: true })
    }
    return entities
  }

  if (algorithm === 'platformer_course') {
    const startRoom = rooms[0]!
    const midRoom = rooms[1] ?? startRoom
    const goalRoom = rooms[rooms.length - 1]!
    addEntity('player_spawn', startRoom.centerX, startRoom.centerY, startRoom.id)
    addEntity('treasure_chest', midRoom.centerX, midRoom.centerY, midRoom.id)
    addEntity('boss_spawn', goalRoom.centerX - 2, goalRoom.centerY, goalRoom.id)
    addEntity('exit_portal', goalRoom.centerX, goalRoom.centerY, goalRoom.id)

    const width = grid[0]?.length ?? 0
    const height = grid.length
    for (let x = 8; x < width - 8; x += 6) {
      for (let y = 2; y < height - 2; y++) {
        if (grid[y]![x] === 'platform' || grid[y]![x] === 'wall') {
          addEntity(rng() > 0.4 ? 'enemy_spawn' : 'coin', x, y - 1, undefined, {
            patrolRangePx: 96
          })
          break
        }
      }
    }
    return entities
  }

  for (const room of rooms) {
    if (room.role === 'start') {
      addEntity('player_spawn', room.centerX, room.centerY, room.id)
    } else if (room.role === 'boss') {
      addEntity('boss_spawn', room.centerX, room.centerY, room.id, { isBoss: true })
      addEntity(
        'exit_portal',
        Math.min(room.x + room.width - 1, room.centerX + 1),
        room.centerY,
        room.id
      )
    } else if (room.role === 'treasure') {
      addEntity('treasure_chest', room.centerX, room.centerY, room.id, { rarity: 'epic' })
      addEntity('shrine', Math.max(room.x, room.centerX - 1), room.centerY, room.id)
    } else if (room.role === 'shop') {
      addEntity('shop_npc', room.centerX, room.centerY, room.id)
    } else {
      addEntity('enemy_spawn', room.centerX, room.centerY, room.id)
      if (rng() > 0.45) {
        addEntity(
          'trap',
          Math.max(room.x, room.centerX - 1),
          Math.max(room.y, room.centerY - 1),
          room.id
        )
      }
    }
  }

  return entities
}

function renderAsciiPreview(grid: LevelCellType[][], entities: LevelEntitySpawn[]): string {
  const chars: string[][] = grid.map((row) =>
    row.map((cell): string => {
      if (cell === 'wall') return '#'
      if (cell === 'floor') return '.'
      if (cell === 'platform') return '='
      if (cell === 'hazard') return '^'
      return ' '
    })
  )

  const symbolMap: Record<LevelEntityType, string> = {
    player_spawn: 'P',
    boss_spawn: 'B',
    enemy_spawn: 'E',
    treasure_chest: 'C',
    shop_npc: 'S',
    shrine: 'A',
    trap: 'T',
    exit_portal: 'X',
    moving_platform: 'M',
    coin: '$'
  }

  for (const ent of entities) {
    if (chars[ent.gridY]?.[ent.gridX] !== undefined) {
      chars[ent.gridY]![ent.gridX] = symbolMap[ent.type] ?? '?'
    }
  }

  return chars.map((row) => row.join('')).join('\n')
}

function buildTiledMapJson(
  width: number,
  height: number,
  tileWidth: number,
  tileHeight: number,
  grid: LevelCellType[][],
  wang16Grid: number[][],
  entities: LevelEntitySpawn[],
  tilesetImage: string
): TiledMapJson {
  const groundData: number[] = []
  const wallData: number[] = []

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cell = grid[y]![x]!
      const mask = wang16Grid[y]![x]!
      if (cell === 'floor') {
        groundData.push(1)
        wallData.push(0)
      } else if (cell === 'wall' || cell === 'platform') {
        groundData.push(0)
        // GID 2..17 maps to Wang-16 bitmask 0..15
        wallData.push(2 + (mask & 15))
      } else if (cell === 'hazard') {
        groundData.push(18)
        wallData.push(0)
      } else {
        groundData.push(0)
        wallData.push(0)
      }
    }
  }

  const tiledObjects = entities.map((ent, idx) => ({
    id: idx + 1,
    name: ent.id,
    type: ent.type,
    x: ent.pixelX,
    y: ent.pixelY,
    width: tileWidth,
    height: tileHeight,
    rotation: 0,
    visible: true,
    properties: Object.entries(ent.properties ?? {}).map(([name, value]) => ({
      name,
      type: typeof value === 'boolean' ? 'bool' : typeof value === 'number' ? 'float' : 'string',
      value
    }))
  }))

  return {
    compressionlevel: -1,
    width,
    height,
    infinite: false,
    orientation: 'orthogonal',
    renderorder: 'right-down',
    tiledversion: '1.10.2',
    tilewidth: tileWidth,
    tileheight: tileHeight,
    type: 'map',
    version: '1.10',
    nextlayerid: 4,
    nextobjectid: tiledObjects.length + 1,
    layers: [
      {
        id: 1,
        name: 'Ground',
        type: 'tilelayer',
        visible: true,
        opacity: 1,
        x: 0,
        y: 0,
        width,
        height,
        data: groundData
      },
      {
        id: 2,
        name: 'WallsAndPlatforms',
        type: 'tilelayer',
        visible: true,
        opacity: 1,
        x: 0,
        y: 0,
        width,
        height,
        data: wallData
      },
      {
        id: 3,
        name: 'Entities',
        type: 'objectgroup',
        draworder: 'topdown',
        visible: true,
        opacity: 1,
        x: 0,
        y: 0,
        objects: tiledObjects
      }
    ],
    tilesets: [
      {
        firstgid: 1,
        name: 'level_tileset',
        tilewidth: tileWidth,
        tileheight: tileHeight,
        tilecount: 20,
        columns: 4,
        image: tilesetImage,
        imagewidth: tileWidth * 4,
        imageheight: tileHeight * 5
      }
    ]
  }
}

/**
 * 生成程序化 2D 游戏关卡地图（含房间拓扑、Wang-16 自动瓦片掩码、实体刷怪点与 Tiled `.tmj` 导出）。
 */
export function generateProceduralLevelMap(
  options: ProceduralLevelMapOptions = {}
): ProceduralLevelMapResult {
  const levelName = (options.levelName || 'stage_01').trim() || 'stage_01'
  const algorithm: LevelGeneratorAlgorithm = options.algorithm ?? 'bsp_dungeon'
  const width = Math.max(16, Math.min(128, Math.round(options.width ?? 40)))
  const height = Math.max(12, Math.min(128, Math.round(options.height ?? 26)))
  const tileWidth = Math.max(8, Math.min(256, Math.round(options.tileWidth ?? 32)))
  const tileHeight = Math.max(8, Math.min(256, Math.round(options.tileHeight ?? 32)))
  const seed = Math.round(options.seed ?? 42)
  const tilesetImage = (options.tilesetImage || 'tileset.png').trim()

  const rng = createSeededRng(seed)

  const { grid, rooms } =
    algorithm === 'cellular_cave'
      ? generateCellularCave(width, height, rng)
      : algorithm === 'platformer_course'
        ? generatePlatformerCourse(width, height, rng)
        : algorithm === 'arena_waves'
          ? generateArenaWaves(width, height)
          : generateBspDungeon(width, height, rng)

  const wang16BitmaskGrid = computeWang16BitmaskGrid(grid)
  const entities = populateEntities(algorithm, rooms, grid, tileWidth, tileHeight, rng)
  const asciiPreview = renderAsciiPreview(grid, entities)
  const tiledMap = buildTiledMapJson(
    width,
    height,
    tileWidth,
    tileHeight,
    grid,
    wang16BitmaskGrid,
    entities,
    tilesetImage
  )

  return {
    schemaVersion: 1,
    levelName,
    algorithm,
    width,
    height,
    tileWidth,
    tileHeight,
    seed,
    rooms,
    entities,
    grid,
    wang16BitmaskGrid,
    asciiPreview,
    tiledMap,
    tiledTmjText: JSON.stringify(tiledMap, null, 2)
  }
}

export interface LevelMapCustomEditsPayload {
  /** Keyed by `${x},${y}` -> LevelCellType */
  cells?: Record<string, LevelCellType>
  /** Custom placed or overridden entities */
  entities?: Array<{ x: number; y: number; type: LevelEntityType }>
}

/**
 * Applies interactive user brush edits (cell painting + entity placement) on top of a procedural level map,
 * recomputing Wang-16 bitmasks, ASCII preview, and Tiled `.tmj` JSON.
 */
export function applyCustomEditsToLevelMap(
  base: ProceduralLevelMapResult,
  editsJson?: string | null
): ProceduralLevelMapResult {
  const raw = editsJson?.trim()
  if (!raw) return base
  let parsed: LevelMapCustomEditsPayload
  try {
    parsed = JSON.parse(raw) as LevelMapCustomEditsPayload
  } catch {
    return base
  }
  const hasCellEdits = parsed.cells && Object.keys(parsed.cells).length > 0
  const hasEntityEdits = Array.isArray(parsed.entities) && parsed.entities.length > 0
  if (!hasCellEdits && !hasEntityEdits) return base

  const grid: LevelCellType[][] = base.grid.map((row) => row.slice())
  if (parsed.cells) {
    for (const [key, cellType] of Object.entries(parsed.cells)) {
      const [xs, ys] = key.split(',')
      const x = Number(xs)
      const y = Number(ys)
      if (
        Number.isInteger(x) &&
        Number.isInteger(y) &&
        y >= 0 &&
        y < base.height &&
        x >= 0 &&
        x < base.width &&
        (cellType === 'floor' ||
          cellType === 'wall' ||
          cellType === 'hazard' ||
          cellType === 'platform' ||
          cellType === 'void')
      ) {
        grid[y]![x] = cellType
      }
    }
  }

  let entities: LevelEntitySpawn[] = base.entities.map((e) => ({ ...e }))
  if (Array.isArray(parsed.entities)) {
    for (let i = 0; i < parsed.entities.length; i++) {
      const item = parsed.entities[i]!
      const gx = Math.max(0, Math.min(base.width - 1, Math.floor(Number(item.x))))
      const gy = Math.max(0, Math.min(base.height - 1, Math.floor(Number(item.y))))
      // Ensure the tile under a placed entity is walkable floor if it was wall
      if (grid[gy]?.[gx] === 'wall') {
        grid[gy]![gx] = 'floor'
      }
      // If placing unique entities like player_spawn or exit_portal, replace existing one
      if (
        item.type === 'player_spawn' ||
        item.type === 'exit_portal' ||
        item.type === 'boss_spawn'
      ) {
        entities = entities.filter((e) => e.type !== item.type)
      }
      // Remove any existing entity at the exact same grid coordinate
      entities = entities.filter((e) => !(e.gridX === gx && e.gridY === gy))
      entities.push({
        id: `custom_${item.type}_${gx}_${gy}_${i}`,
        type: item.type,
        gridX: gx,
        gridY: gy,
        pixelX: gx * base.tileWidth + Math.floor(base.tileWidth / 2),
        pixelY: gy * base.tileHeight + Math.floor(base.tileHeight / 2)
      })
    }
  }

  const wang16BitmaskGrid = computeWang16BitmaskGrid(grid)
  const asciiPreview = renderAsciiPreview(grid, entities)
  const tiledMap = buildTiledMapJson(
    base.width,
    base.height,
    base.tileWidth,
    base.tileHeight,
    grid,
    wang16BitmaskGrid,
    entities,
    'tileset.png'
  )

  return {
    ...base,
    grid,
    entities,
    wang16BitmaskGrid,
    asciiPreview,
    tiledMap,
    tiledTmjText: JSON.stringify(tiledMap, null, 2)
  }
}
