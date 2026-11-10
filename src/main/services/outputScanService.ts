/**
 * 工程产物扫盘服务（只读）。
 *
 * 用途：AI 对话每轮结束时，把 agent 直接落盘的产物（脚本写出的 SVG / 帧序列等，
 * 不经 MCP 活动链路）也搬进对话卡。收录范围与筛选口径见 `@shared/outputScan`。
 *
 * 约束与取舍：
 * - 只读：只 readdir / stat，绝不写盘、不建目录；
 * - 只遍历工程根下的 `Output/` 与 `Cache/`（目录名固定，调用方无法用参数把扫描引到工程外）；
 * - 文件数与目录深度都有上限，目录不存在 / 无权限一律当空处理；
 * - 任何失败都返回空清单而不是抛异常——产物卡是旁路展示，不该打断会话。
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  utimesSync,
  type Dirent
} from 'fs'
import { basename, dirname, extname, join, relative, resolve } from 'path'
import {
  SCANNED_OUTPUT_DIRS,
  isPreviewableOutputFileName,
  isScannedOutputPath,
  type ProjectOutputFile
} from '@shared/outputScan'
import { projectService } from './projectService'

/** 单次扫描读取的文件数上限（防止超大产物目录把一轮对话拖住） */
const MAX_SCAN_FILES = 4000
/** 目录递归深度上限（帧序列 / 分层导出可能很深） */
const MAX_SCAN_DEPTH = 8

/** 扫描工程根散落产物时跳过的一级系统目录（小写） */
const IGNORED_ROOT_DIRS = new Set<string>([
  ...SCANNED_OUTPUT_DIRS.map((d) => d.toLowerCase()),
  'assets',
  'thumbnails',
  'gameplay',
  'node_modules',
  'dist',
  'build',
  'src',
  'vendor'
])

/**
 * 归拢第三方技能直接写到工程根或自定义子目录的本轮产物到 `Output/`：
 * 第三方 GitHub 技能自带的 `build.mjs` / 脚本常把 `.html` / `.svg` / `.png` 直接落盘在 `cwd`（工程根），
 * 将本轮新写入的可预览文件同步拷入 `Output/`（保留原 mtime），使 `Output/` 扫盘链路统一收录出卡。
 */
export function harvestStrayWorkspaceOutputs(root: string, sinceMs: number): void {
  if (!(sinceMs > 0)) return
  const walkRoot = (dirAbs: string, relPrefix: string, depth: number): void => {
    if (depth > 2) return
    let entries: Dirent[]
    try {
      entries = readdirSync(dirAbs, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const name = entry.name
      if (name.startsWith('.')) continue
      if (entry.isDirectory()) {
        if (depth === 0 && IGNORED_ROOT_DIRS.has(name.toLowerCase())) continue
        walkRoot(join(dirAbs, name), relPrefix ? `${relPrefix}/${name}` : name, depth + 1)
        continue
      }
      if (!entry.isFile() || !isPreviewableOutputFileName(name)) continue
      const srcAbs = join(dirAbs, name)
      let st
      try {
        st = statSync(srcAbs)
      } catch {
        continue
      }
      if (st.mtimeMs < sinceMs || st.size <= 0) continue
      const relTarget = relPrefix ? `${relPrefix}/${name}` : name
      const destAbs = join(root, 'Output', ...relTarget.split('/'))
      try {
        if (existsSync(destAbs)) {
          const destSt = statSync(destAbs)
          if (destSt.mtimeMs >= st.mtimeMs && destSt.size === st.size) continue
        }
        mkdirSync(dirname(destAbs), { recursive: true })
        copyFileSync(srcAbs, destAbs)
        utimesSync(destAbs, st.atime, st.mtime)
      } catch {
        // 归拢失败不阻断扫盘
      }
    }
  }
  walkRoot(root, '', 0)
}

/** 扫描工程 `Output/` 与 `Cache/` 下、不早于 `sinceMs` 写入的可预览媒体 */
export function scanProjectOutputFiles(input: { sinceMs?: number }): ProjectOutputFile[] {
  if (!projectService.isOpen()) return []
  const root = projectService.getRoot()
  if (!root) return []
  const sinceMs = Number.isFinite(input?.sinceMs) ? Number(input?.sinceMs) : 0
  harvestStrayWorkspaceOutputs(root, sinceMs)
  const files: ProjectOutputFile[] = []
  let visited = 0

  const walk = (dirAbs: string, relDir: string, depth: number): void => {
    if (depth > MAX_SCAN_DEPTH || visited >= MAX_SCAN_FILES) return
    let entries: Dirent[]
    try {
      entries = readdirSync(dirAbs, { withFileTypes: true })
    } catch {
      // 目录不存在 / 无权限：当作没有产物
      return
    }
    for (const entry of entries) {
      if (visited >= MAX_SCAN_FILES) return
      const name = entry.name
      if (name.startsWith('.')) continue
      const rel = `${relDir}/${name}`
      if (entry.isDirectory()) {
        walk(join(dirAbs, name), rel, depth + 1)
        continue
      }
      if (!entry.isFile()) continue
      // 先按路径口径过滤（媒体类型 + 元数据排除），避免对每个文件都 stat
      if (!isScannedOutputPath(rel)) continue
      let stat
      try {
        stat = statSync(join(dirAbs, name))
      } catch {
        continue
      }
      visited += 1
      if (stat.mtimeMs < sinceMs || stat.size <= 0) continue
      files.push({ relativePath: rel, mtimeMs: stat.mtimeMs, size: stat.size })
    }
  }

  for (const dir of SCANNED_OUTPUT_DIRS) {
    walk(join(root, dir), dir, 1)
  }
  return files
}

const IGNORED_ATLAS_SCAN_DIRS = new Set<string>([
  '.git',
  '.svn',
  '.hg',
  '.idea',
  '.vscode',
  'node_modules',
  'dist',
  'build',
  'out',
  'temp',
  'tmp',
  'library',
  'obj',
  'logs',
  'thumbnails'
])

const ATLAS_IMAGE_EXTENSIONS = new Set<string>(['.png', '.webp', '.jpg', '.jpeg'])

const UI_PATH_HINT_RE =
  /ui|atlas|sprite|slice|9slice|common|comm|gui|hud|skin|icon|btn|button|slot|cell|tab|panel|frame|bar|banner|window|dialog|badge|图集|界面|组件|切片|按钮|底板|面板|边框|图标|背包|道具|槽位|页签/i // cjk-ok

const PROMPT_CONCEPT_EXPANSIONS: Array<{ test: RegExp; tokens: string[] }> = [
  {
    test: /背包|bag|backpack|inventory/i, // cjk-ok
    tokens: ['bag', 'backpack', 'inventory', 'pack', '背包'] // cjk-ok
  },
  {
    test: /道具|物品|item|prop/i, // cjk-ok
    tokens: ['item', 'prop', 'goods', '道具', '物品'] // cjk-ok
  },
  {
    test: /装备|武器|equip|weapon|gear/i, // cjk-ok
    tokens: ['equip', 'weapon', 'armor', 'gear', '装备'] // cjk-ok
  },
  {
    test: /碎片|晶石|舰炮|shard|gem|cannon/i, // cjk-ok
    tokens: ['shard', 'piece', 'gem', 'stone', 'cannon', '碎片', '晶石', '舰炮'] // cjk-ok
  },
  {
    test: /金币|体力|钻石|资源|coin|gold|diamond|energy|stamina/i, // cjk-ok
    tokens: ['coin', 'gold', 'diamond', 'gem', 'energy', 'stamina', 'res', '金币', '体力', '钻石'] // cjk-ok
  },
  {
    test: /按钮|整理|筛选|升品|多选|btn|button/i, // cjk-ok
    tokens: ['btn', 'button', '按钮'] // cjk-ok
  },
  {
    test: /页签|导航|tab|nav/i, // cjk-ok
    tokens: ['tab', 'nav', 'menu', '页签', '导航'] // cjk-ok
  },
  {
    test: /道具格|格子|槽|slot|cell|grid/i, // cjk-ok
    tokens: ['slot', 'cell', 'grid', 'box', 'frame', '格', '槽'] // cjk-ok
  },
  {
    test: /进度条|容量|bar|progress|slider/i, // cjk-ok
    tokens: ['bar', 'progress', 'slider', 'gauge', 'fill', '进度条'] // cjk-ok
  },
  {
    test: /红点|角标|锁定|badge|dot|lock/i, // cjk-ok
    tokens: ['badge', 'dot', 'reddot', 'lock', 'tag', '红点', '角标'] // cjk-ok
  },
  {
    test: /窗口|底板|面板|弹窗|panel|window|dialog|bg/i, // cjk-ok
    tokens: [
      'panel',
      'window',
      'dialog',
      'bg',
      'common_bg2',
      'popup',
      'frame',
      'board',
      '底板', // cjk-ok
      '面板', // cjk-ok
      '窗口' // cjk-ok
    ]
  },
  {
    test: /登录|账号|验证|进入游戏|游客|login|auth|verify|sign/i, // cjk-ok
    tokens: ['login', 'common_login', 'common_bg', 'verify', 'auth', 'btn', '登录'] // cjk-ok
  },
  {
    test: /logo|标题|标志|徽标|title/i, // cjk-ok
    tokens: ['logo', 'logo1', 'title', 'banner', '标题'] // cjk-ok
  },
  {
    test: /协议|隐私|条款|勾选|适龄|protocol|privacy|agree|check/i, // cjk-ok
    tokens: ['protocol', 'privacy', 'agree', 'check', '协议'] // cjk-ok
  },
  {
    test: /关闭|返回|退出|叉号|close|back|exit/i, // cjk-ok
    tokens: ['close', 'btn_close', 'equip_close', 'back', '关闭'] // cjk-ok
  },
  {
    test: /背景|底图|壁纸|background|wallpaper/i, // cjk-ok
    tokens: ['common_bg1', 'common_bg', 'bg1', 'bg', 'background', '背景'] // cjk-ok
  }
]

const UI_DIR_PRIORITY_HIGH_RE =
  /^(preloadres|ui|uiprefabs|textures|sprites|atlas|resources|common|popup|icons?|hud|gui|login)$/i
const UI_DIR_PRIORITY_LOW_RE =
  /^(effects?|fx|vfx|particles?|shaders?|models?|meshes|scenes?|anna|audio|sounds?|fonts?|animations?|anims?|bundleassets|bundleres)$/i
const VFX_OR_NON_UI_TEX_RE =
  /(?:^|[/_\\])fx_|_fx_|fx_tex|particle|vfx|shader|lightmap|normalmap|_normal\.|_mask\.|trail|slash|melee/i

function extractPromptAtlasKeywords(prompt?: string): string[] {
  const raw = (prompt ?? '').trim()
  if (!raw) return []
  const set = new Set<string>()
  for (const rule of PROMPT_CONCEPT_EXPANSIONS) {
    if (rule.test.test(raw)) {
      for (const tk of rule.tokens) set.add(tk.toLowerCase())
    }
  }
  const enWords = raw.toLowerCase().match(/[a-z][a-z0-9_]{2,18}/g) ?? []
  for (const w of enWords) {
    set.add(w)
  }
  return [...set]
}

/**
 * 按会话作用域扫描指定目录（如当前项目 `Client_Harmmy`、用户指定的其它项目、或全局会话下的 `Cache` 目录）中的 UI / 图集图片。
 * 返回可直接供 Canvas 解码的 `studio-media://local/?path=...` 条目列表。
 */
export function scanUiAtlasImagesFromDirectories(
  searchDirs?: string[],
  prompt?: string
): Array<{
  id: string
  title: string
  dataUrl: string
  relativePath?: string
}> {
  if (!Array.isArray(searchDirs) || searchDirs.length === 0) return []
  const normalizedDirs: string[] = []
  const seenDirs = new Set<string>()
  for (const d of searchDirs) {
    const cleaned = (d ?? '').trim()
    if (!cleaned) continue
    const abs = resolve(cleaned)
    const key = process.platform === 'win32' ? abs.toLowerCase() : abs
    if (seenDirs.has(key)) continue
    seenDirs.add(key)
    normalizedDirs.push(abs)
  }
  if (!normalizedDirs.length) return []

  const workspaceRoot = projectService.isOpen() ? projectService.getRoot() : ''
  const workspaceRootNorm = workspaceRoot
    ? process.platform === 'win32'
      ? resolve(workspaceRoot).toLowerCase()
      : resolve(workspaceRoot)
    : ''

  const promptKeywords = extractPromptAtlasKeywords(prompt)
  const candidates: Array<{
    id: string
    title: string
    dataUrl: string
    relativePath?: string
    score: number
    mtimeMs: number
  }> = []

  const maxDepth = 7
  const maxVisitedPerDir = 5000

  for (let dirIdx = 0; dirIdx < normalizedDirs.length; dirIdx++) {
    const rootDir = normalizedDirs[dirIdx]!
    if (!existsSync(rootDir)) continue
    let visited = 0
    const dirPriorityScore = (normalizedDirs.length - dirIdx) * 12

    const dirEntryRank = (entry: Dirent): number => {
      if (!entry.isDirectory()) return 1
      const n = entry.name.toLowerCase()
      if (UI_DIR_PRIORITY_HIGH_RE.test(n)) return 0
      if (UI_DIR_PRIORITY_LOW_RE.test(n)) return 3
      return 2
    }

    const walk = (dirAbs: string, relPrefix: string, depth: number): void => {
      if (depth > maxDepth || visited >= maxVisitedPerDir) return
      let entries: Dirent[]
      try {
        entries = readdirSync(dirAbs, { withFileTypes: true })
      } catch {
        return
      }
      entries.sort((a, b) => dirEntryRank(a) - dirEntryRank(b))
      for (const entry of entries) {
        if (visited >= maxVisitedPerDir) return
        const name = entry.name
        if (name.startsWith('.')) continue
        const rel = relPrefix ? `${relPrefix}/${name}` : name
        if (entry.isDirectory()) {
          if (IGNORED_ATLAS_SCAN_DIRS.has(name.toLowerCase())) continue
          walk(join(dirAbs, name), rel, depth + 1)
          continue
        }
        if (!entry.isFile()) continue
        const ext = extname(name).toLowerCase()
        if (!ATLAS_IMAGE_EXTENSIONS.has(ext)) continue
        const fileAbs = join(dirAbs, name)
        let st
        try {
          st = statSync(fileAbs)
        } catch {
          continue
        }
        visited += 1
        if (st.size < 120 || st.size > 25 * 1024 * 1024) continue

        const lowerRel = rel.toLowerCase()
        let score = dirPriorityScore
        if (ext === '.png' || ext === '.webp') score += 8
        if (UI_PATH_HINT_RE.test(lowerRel)) score += 18
        if (/(?:^|\/)(preloadres|uiprefabs|textures|sprites|popup|ui)\//i.test(lowerRel)) {
          score += 20
        }
        if (VFX_OR_NON_UI_TEX_RE.test(lowerRel)) {
          score -= 65
        }
        for (const kw of promptKeywords) {
          if (kw && lowerRel.includes(kw)) {
            score += 14
          }
        }
        // Skip composite/preview full-screen exports from previous runs so we pick actual source sprites/atlases first
        if (/composite|preview_full|screenshot/i.test(name)) {
          score -= 20
        }

        const baseTitle = basename(name, ext).trim() || 'UI_Atlas'
        const dataUrl = `studio-media://local/?path=${encodeURIComponent(fileAbs)}`
        let workspaceRel: string | undefined
        if (workspaceRootNorm) {
          const fileAbsNorm =
            process.platform === 'win32' ? resolve(fileAbs).toLowerCase() : resolve(fileAbs)
          if (
            fileAbsNorm.startsWith(workspaceRootNorm + (process.platform === 'win32' ? '\\' : '/'))
          ) {
            workspaceRel = relative(workspaceRoot, fileAbs).replace(/\\/g, '/')
          }
        }
        candidates.push({
          id: `disk-atlas:${dirIdx}:${rel}`,
          title: baseTitle,
          dataUrl,
          ...(workspaceRel ? { relativePath: workspaceRel } : {}),
          score,
          mtimeMs: st.mtimeMs
        })
      }
    }

    walk(rootDir, '', 0)
  }

  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return b.mtimeMs - a.mtimeMs
  })

  return candidates.slice(0, 24).map(({ id, title, dataUrl, relativePath }) => ({
    id,
    title,
    dataUrl,
    ...(relativePath ? { relativePath } : {})
  }))
}
